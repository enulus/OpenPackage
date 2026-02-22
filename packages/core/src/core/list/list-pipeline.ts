import path from 'path';

import type { CommandResult, ExecutionContext } from '../../types/index.js';
import { ValidationError } from '../../utils/errors.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath } from '../../utils/paths.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { exists } from '../../utils/fs.js';
import type { WorkspaceIndexPackage } from '../../types/workspace-index.js';
import { logger } from '../../utils/logger.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { arePackageNamesEquivalent } from '../../utils/package-name.js';
import { scanUntrackedFiles, type UntrackedScanResult } from './untracked-files-scanner.js';
import { getWorkspaceIndexPath } from '../../utils/workspace-index-yml.js';
import { isPlatformId, getAllPlatforms, getPlatformDefinition } from '../platforms.js';
import { normalizePlatforms } from '../../utils/platform-mapper.js';
import { DIR_TO_TYPE, RESOURCE_TYPE_ORDER, toPluralKey, type ResourceTypeId } from '../resources/resource-registry.js';
import { classifySourceKey } from '../resources/source-key-classifier.js';
import { deriveResourceFullName } from '../resources/resource-namespace.js';
export { classifySourceKey } from '../resources/source-key-classifier.js';

export type PackageSyncState = 'synced' | 'partial' | 'missing';

export interface ListFileMapping {
  source: string;
  target: string;
  exists: boolean;
}

/**
 * A single resource within a package (e.g., one rule, one agent, one skill)
 */
export interface ListResourceInfo {
  /** Display name (filename sans .md for files, directory name for skills) */
  name: string;
  /** Resource type: agent, skill, command, rule, hook, mcp, or 'other' for unrecognized */
  resourceType: string;
  /** Files belonging to this resource */
  files: ListFileMapping[];
}

/**
 * Resources grouped by type within a package
 */
export interface ListResourceGroup {
  /** Resource type label (e.g., 'rules', 'agents', 'skills') */
  resourceType: string;
  /** Individual resources of this type */
  resources: ListResourceInfo[];
}

export interface ListPackageReport {
  name: string;
  version?: string;
  path: string;
  state: PackageSyncState;
  totalFiles: number;
  existingFiles: number;
  fileList?: ListFileMapping[];
  resourceGroups?: ListResourceGroup[];
  dependencies?: string[];
}

export interface ListTreeNode {
  report: ListPackageReport;
  children: ListTreeNode[];
}

export interface ListPipelineOptions {
  /** Include full file list for each package */
  includeFiles?: boolean;
  /** Build full recursive dependency tree */
  all?: boolean;
  /** Filter to tracked view only */
  tracked?: boolean;
  /** Filter to untracked view only */
  untracked?: boolean;
  /** Filter by platform names */
  platforms?: string[];
}

export interface ListPipelineResult {
  packages: ListPackageReport[];
  tree?: ListTreeNode[];
  rootPackageNames?: string[];
  /** When a specific package is targeted, this contains its info for the header */
  targetPackage?: ListPackageReport;
  /** Total tracked files that exist on disk */
  trackedCount: number;
  /** Total tracked files that are missing on disk */
  missingCount: number;
  /** Total untracked files found */
  untrackedCount: number;
  /** Untracked files scan result */
  untrackedFiles?: UntrackedScanResult;
}


/**
 * Extract the root directory prefix from a `to` pattern string.
 * e.g. ".cursor/agents/x.md" -> ".cursor", ".config/opencode/agents/x.md" -> ".config/opencode"
 * Returns null for patterns without a dot-prefixed root dir.
 */
function extractRootPrefixFromToPattern(pattern: string): string | null {
  const parts = pattern.replace(/\\/g, '/').split('/');
  if (parts.length < 2 || !parts[0].startsWith('.')) return null;
  const nonGlobParts = [];
  for (const part of parts) {
    if (part.includes('*') || part.includes('{')) break;
    nonGlobParts.push(part);
  }
  if (nonGlobParts.length < 2) return nonGlobParts.length === 1 ? nonGlobParts[0] : null;
  // For paths like ".config/opencode/agents/foo.md", the root prefix is everything
  // up to but not including known resource type dirs or the filename.
  const resourceDirs = new Set(Object.keys(DIR_TO_TYPE));
  const prefixParts = [];
  for (const part of nonGlobParts) {
    if (resourceDirs.has(part)) break;
    if (part.includes('.') && part !== nonGlobParts[0]) break;
    prefixParts.push(part);
  }
  return prefixParts.length > 0 ? prefixParts.join('/') : null;
}

/**
 * Collect all `to` pattern strings from a flow, including $switch cases.
 */
function collectToPatternsFromFlow(toField: unknown): string[] {
  if (typeof toField === 'string') return [toField];

  if (typeof toField === 'object' && toField !== null) {
    if ('$switch' in toField) {
      const sw = (toField as any).$switch;
      const patterns: string[] = [];
      for (const c of sw?.cases ?? []) {
        const v = c.value;
        if (typeof v === 'string') patterns.push(v);
        else if (typeof v === 'object' && v && 'pattern' in v) patterns.push(v.pattern);
      }
      const d = sw?.default;
      if (typeof d === 'string') patterns.push(d);
      else if (typeof d === 'object' && d && 'pattern' in d) patterns.push(d.pattern);
      return patterns;
    }
    if ('pattern' in toField && typeof (toField as any).pattern === 'string') {
      return [(toField as any).pattern];
    }
  }
  return [];
}

/**
 * Build a mapping from root directory prefixes to platform IDs.
 * Collects all root prefixes from every export flow `to` pattern (including $switch cases).
 * Cached per targetDir to avoid recomputing on every file.
 */
const rootDirCacheMap = new Map<string, Map<string, string>>();

function getRootDirToPlatformMap(targetDir: string): Map<string, string> {
  const cached = rootDirCacheMap.get(targetDir);
  if (cached) return cached;

  const map = new Map<string, string>();
  for (const platform of getAllPlatforms({ includeDisabled: true }, targetDir)) {
    const definition = getPlatformDefinition(platform, targetDir);
    if (!definition.export) continue;
    for (const flow of definition.export) {
      for (const pattern of collectToPatternsFromFlow(flow.to)) {
        const prefix = extractRootPrefixFromToPattern(pattern);
        if (prefix && !map.has(prefix)) {
          map.set(prefix, platform);
        }
      }
    }
  }
  rootDirCacheMap.set(targetDir, map);
  return map;
}

/**
 * Extract platform from a target path by matching its root directory against
 * known platform root directories derived from export flows.
 * Returns null if the file is universal (no platform).
 *
 * @param targetPath - Target path relative to workspace (e.g., ".cursor/agents/foo.md")
 * @param targetDir - Target directory for context and flow resolution
 * @returns Platform ID or null if universal
 */
function extractPlatformFromPath(targetPath: string, targetDir: string): string | null {
  const normalized = targetPath.replace(/\\/g, '/');

  // Check if the path starts with a known platform root directory
  // Sort by longest prefix first so more-specific prefixes match before shorter ones
  const rootDirMap = getRootDirToPlatformMap(targetDir);
  const sortedEntries = [...rootDirMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [rootDir, platform] of sortedEntries) {
    if (normalized === rootDir || normalized.startsWith(rootDir + '/')) {
      return platform;
    }
  }

  // Fallback: Check for platform suffix in filename (e.g., mcp.cursor.jsonc, rule.claude.md)
  const parts = normalized.split('/');
  const filename = parts[parts.length - 1];
  const nameParts = filename.split('.');

  // Need at least 3 parts: name.platform.ext
  if (nameParts.length >= 3) {
    const possiblePlatform = nameParts[nameParts.length - 2];
    if (isPlatformId(possiblePlatform, targetDir)) {
      return possiblePlatform;
    }
  }

  // No platform detected - this is a universal file
  return null;
}

/**
 * Group file mappings into resource groups by analyzing source keys.
 *
 * For skills, all files sharing the same skills/<name>/ prefix are grouped into one resource.
 * For other types, each source key maps to one resource.
 */
export function groupFilesIntoResources(fileList: ListFileMapping[]): ListResourceGroup[] {
  // First pass: classify each file and group by resource identity
  const resourceMap = new Map<string, ListResourceInfo>();

  for (const file of fileList) {
    const { resourceType } = classifySourceKey(file.source);
    const fullName = deriveResourceFullName(file.source, resourceType);
    const key = fullName;

    if (!resourceMap.has(key)) {
      resourceMap.set(key, {
        name: fullName,
        resourceType,
        files: []
      });
    }
    resourceMap.get(key)!.files.push(file);
  }

  // Second pass: group resources by type
  const typeGroupMap = new Map<string, ListResourceInfo[]>();

  for (const resource of resourceMap.values()) {
    if (!typeGroupMap.has(resource.resourceType)) {
      typeGroupMap.set(resource.resourceType, []);
    }
    typeGroupMap.get(resource.resourceType)!.push(resource);
  }

  // Build final groups, sorted by type then by resource name
  const typeOrder = RESOURCE_TYPE_ORDER;
  const groups: ListResourceGroup[] = [];

  for (const type of typeOrder) {
    const resources = typeGroupMap.get(type);
    if (!resources || resources.length === 0) continue;

    // Sort resources by name
    resources.sort((a, b) => a.name.localeCompare(b.name));

    // Sort files within each resource by target path
    for (const resource of resources) {
      resource.files.sort((a, b) => a.target.localeCompare(b.target));
    }

    // Use plural form for group label
    const pluralLabel = toPluralKey(type as ResourceTypeId);
    groups.push({ resourceType: pluralLabel, resources });
  }

  // Handle any types not in typeOrder
  for (const [type, resources] of typeGroupMap) {
    if ((typeOrder as readonly string[]).includes(type)) continue;
    resources.sort((a, b) => a.name.localeCompare(b.name));
    for (const resource of resources) {
      resource.files.sort((a, b) => a.target.localeCompare(b.target));
    }
    groups.push({ resourceType: `${type}s`, resources });
  }

  return groups;
}

/**
 * Check package list status by verifying file existence
 * Does not compare content - only checks if expected files exist
 */
async function checkPackageStatus(
  targetDir: string,
  pkgName: string,
  entry: WorkspaceIndexPackage,
  includeFileList: boolean = false,
  platformsFilter?: string[]
): Promise<ListPackageReport> {
  const totalTargets = entry.files
    ? Object.values(entry.files).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0;
  const resolved = resolveDeclaredPath(entry.path, targetDir);
  const sourceRoot = resolved.absolute;

  // Check if source path exists
  const sourceExists = await exists(sourceRoot);

  // When source path is gone but we have workspace file mappings, determine state from
  // workspace targets instead of marking the package missing (e.g. index.path was a temp dir).
  const canDeriveFromFiles = totalTargets > 0;
  if (!sourceExists && !canDeriveFromFiles) {
    return {
      name: pkgName,
      version: entry.version,
      path: entry.path,
      state: 'missing',
      totalFiles: 0,
      existingFiles: 0,
      fileList: includeFileList ? [] : undefined
    };
  }

  // Check workspace file existence
  let totalFiles = 0;
  let existingFiles = 0;
  const fileList: ListFileMapping[] = [];
  
  const filesMapping = entry.files || {};
  
  // Normalize platform filter
  const normalizedPlatforms = platformsFilter ? normalizePlatforms(platformsFilter) : null;

  for (const [sourceKey, targets] of Object.entries(filesMapping)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;

    for (const mapping of targets) {
      const targetPath = getTargetPath(mapping);
      
      // Apply platform filter if specified
      if (normalizedPlatforms && normalizedPlatforms.length > 0) {
        const filePlatform = extractPlatformFromPath(targetPath, targetDir);
        
        // If the file has a platform, check if it matches the filter
        if (filePlatform) {
          if (!normalizedPlatforms.includes(filePlatform.toLowerCase())) {
            continue; // Skip this file - it doesn't match the platform filter
          }
        }
        // If the file has no platform (universal), include it in all platform filters
      }
      
      const absPath = path.join(targetDir, targetPath);
      totalFiles++;
      
      const fileExists = await exists(absPath);
      if (fileExists) {
        existingFiles++;
      }
      if (includeFileList) {
        fileList.push({
          source: sourceKey,
          target: targetPath,
          exists: fileExists
        });
      }
    }
  }

  // Classify package state
  const state: PackageSyncState = existingFiles === totalFiles ? 'synced' : 'partial';

  // Read dependencies from the package manifest (not workspace index)
  let dependencies: string[] | undefined = entry.dependencies;
  if (!dependencies || dependencies.length === 0) {
    try {
      const pkgManifestPath = path.join(sourceRoot, 'openpackage.yml');
      if (await exists(pkgManifestPath)) {
        const pkgManifest = await parsePackageYml(pkgManifestPath);
        const allDeps = [
          ...(pkgManifest.dependencies || []),
          ...(pkgManifest['dev-dependencies'] || [])
        ];
        dependencies = allDeps.map(dep => dep.name);
      }
    } catch (error) {
      logger.debug(`Failed to read package manifest for ${pkgName}: ${error}`);
    }
  }

  // Always compute resource groups from the file data we collected
  const allFilesForGrouping: ListFileMapping[] = includeFileList ? fileList : [];

  // If we didn't collect file details for the list, we still need them for resource grouping
  if (!includeFileList) {
    for (const [sourceKey, targets] of Object.entries(filesMapping)) {
      if (!Array.isArray(targets) || targets.length === 0) continue;
      for (const mapping of targets) {
        const targetPath = getTargetPath(mapping);
        
        // Apply platform filter if specified
        if (normalizedPlatforms && normalizedPlatforms.length > 0) {
          const filePlatform = extractPlatformFromPath(targetPath, targetDir);
          
          // If the file has a platform, check if it matches the filter
          if (filePlatform) {
            if (!normalizedPlatforms.includes(filePlatform.toLowerCase())) {
              continue; // Skip this file - it doesn't match the platform filter
            }
          }
          // If the file has no platform (universal), include it in all platform filters
        }
        
        allFilesForGrouping.push({
          source: sourceKey,
          target: targetPath,
          exists: true
        });
      }
    }
  }

  const resourceGroups = allFilesForGrouping.length > 0
    ? groupFilesIntoResources(allFilesForGrouping)
    : undefined;

  return {
    name: pkgName,
    version: entry.version,
    path: entry.path,
    state,
    totalFiles,
    existingFiles,
    fileList: includeFileList ? fileList : undefined,
    resourceGroups,
    dependencies
  };
}

/**
 * Build a dependency tree from package reports
 */
function buildDependencyTree(
  rootNames: string[],
  reportMap: Map<string, ListPackageReport>,
  all: boolean
): ListTreeNode[] {
  const visited = new Set<string>();

  function buildNode(pkgName: string, depth: number): ListTreeNode | null {
    const report = reportMap.get(pkgName);
    if (!report) return null;

    // Prevent infinite loops from circular dependencies
    if (visited.has(pkgName)) {
      return {
        report: { ...report, name: `${report.name} (circular)` },
        children: []
      };
    }

    visited.add(pkgName);

    let children: ListTreeNode[] = [];
    if (all && report.dependencies && report.dependencies.length > 0) {
      children = report.dependencies
        .map(depName => buildNode(depName, depth + 1))
        .filter((node): node is ListTreeNode => node !== null);
    }

    visited.delete(pkgName);

    return { report, children };
  }

  return rootNames
    .map(name => buildNode(name, 0))
    .filter((node): node is ListTreeNode => node !== null);
}

export async function runListPipeline(
  packageName: string | undefined,
  execContext: ExecutionContext,
  options: ListPipelineOptions = {}
): Promise<CommandResult<ListPipelineResult>> {
  const { includeFiles = false, all = false, tracked = false, untracked = false, platforms } = options;
  
  // Use targetDir for list operations
  const targetDir = execContext.targetDir;
  const indexPath = getWorkspaceIndexPath(targetDir);

  // Validate mutual exclusivity
  if (tracked && untracked) {
    throw new ValidationError('Cannot use --tracked and --untracked together.');
  }

  // For --untracked only, we just need the workspace index (not the full manifest)
  if (untracked) {
    if (!(await exists(indexPath))) {
      throw new ValidationError(
        `No workspace index found at ${indexPath}. Cannot scan for untracked files.`
      );
    }

    const untrackedFiles = await scanUntrackedFiles(targetDir, platforms);

    return {
      success: true,
      data: {
        packages: [],
        tree: [],
        rootPackageNames: [],
        trackedCount: 0,
        missingCount: 0,
        untrackedCount: untrackedFiles.totalFiles,
        untrackedFiles
      }
    };
  }

  // Regular list operation - require both index and manifest
  const openpkgDir = getLocalOpenPackageDir(targetDir);
  const manifestPath = getLocalPackageYmlPath(targetDir);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${targetDir}.`
    );
  }

  const { index } = await readWorkspaceIndex(targetDir);
  const packages = index.packages || {};
  const reports: ListPackageReport[] = [];
  const reportMap = new Map<string, ListPackageReport>();

  // Get workspace config to find root packages
  let rootPackageNames: string[] = [];
  let workspacePackageName: string | undefined;
  try {
    const config = await parsePackageYml(manifestPath);
    workspacePackageName = config.name;
    // Root packages are those declared in dependencies/dev-dependencies
    const declaredDeps = [
      ...(config.dependencies || []),
      ...(config['dev-dependencies'] || [])
    ];
    rootPackageNames = declaredDeps.map(dep => dep.name);
    // Include workspace package in tree roots when it's in the index (so its resources are listed)
    if (workspacePackageName && packages[workspacePackageName]) {
      rootPackageNames = [workspacePackageName, ...rootPackageNames];
    }
  } catch (error) {
    logger.warn(`Failed to read workspace manifest: ${error}`);
  }

  // If specific package requested, that package becomes the "root" and we show its dependencies
  if (packageName) {
    const pkgEntry = packages[packageName];
    if (!pkgEntry) {
      return {
        success: true,
        data: { packages: [], rootPackageNames: [], trackedCount: 0, missingCount: 0, untrackedCount: 0 }
      };
    }

    let targetPackage: ListPackageReport;
    try {
      targetPackage = await checkPackageStatus(targetDir, packageName, pkgEntry, true, platforms);
      reports.push(targetPackage);
      reportMap.set(packageName, targetPackage);
    } catch (error) {
      logger.warn(`Failed to check package ${packageName}: ${error}`);
      targetPackage = {
        name: packageName,
        version: pkgEntry?.version,
        path: pkgEntry?.path ?? '',
        state: 'missing',
        totalFiles: 0,
        existingFiles: 0,
        fileList: [],
        dependencies: pkgEntry?.dependencies
      };
      reports.push(targetPackage);
      reportMap.set(packageName, targetPackage);
    }

    // Load the target package's dependencies as tree nodes
    const depNames = targetPackage.dependencies || [];
    for (const depName of depNames) {
      if (reportMap.has(depName)) continue;
      
      const depEntry = packages[depName];
      if (!depEntry) continue;
      
      try {
        const depReport = await checkPackageStatus(targetDir, depName, depEntry, includeFiles, platforms);
        reportMap.set(depName, depReport);
      } catch (error) {
        logger.debug(`Failed to load dependency ${depName}: ${error}`);
      }
    }

    // If full tree (deps view), recursively load nested dependencies
    if (all) {
      const loadNestedDeps = async (names: string[]) => {
        for (const name of names) {
          const report = reportMap.get(name);
          if (!report?.dependencies) continue;
          
          for (const nestedDepName of report.dependencies) {
            if (reportMap.has(nestedDepName)) continue;
            
            const nestedEntry = packages[nestedDepName];
            if (!nestedEntry) continue;
            
            try {
              const nestedReport = await checkPackageStatus(targetDir, nestedDepName, nestedEntry, includeFiles, platforms);
              reportMap.set(nestedDepName, nestedReport);
              
              if (nestedReport.dependencies && nestedReport.dependencies.length > 0) {
                await loadNestedDeps([nestedDepName]);
              }
            } catch (error) {
              logger.debug(`Failed to load nested dependency ${nestedDepName}: ${error}`);
            }
          }
        }
      };
      await loadNestedDeps(depNames);
    }

    // Build tree from the target package's dependencies (not the package itself)
    const tree = buildDependencyTree(depNames, reportMap, all);
    
    // When listing a specific package, also create a tree node for the target package itself
    // so its resources can be displayed
    const targetTreeNode: ListTreeNode = {
      report: targetPackage,
      children: tree
    };
    const treeWithTarget = [targetTreeNode];

    // Compute tracked/missing counts from reports
    const trackedCount = reports.reduce((sum, r) => sum + r.existingFiles, 0);
    const missingCount = reports.reduce((sum, r) => sum + (r.totalFiles - r.existingFiles), 0);

    // Scan untracked files unless --tracked flag is set
    let untrackedFiles: UntrackedScanResult | undefined;
    let untrackedCount = 0;
    if (!tracked) {
      untrackedFiles = await scanUntrackedFiles(targetDir, platforms);
      untrackedCount = untrackedFiles.totalFiles;
    }

    return {
      success: true,
      data: { packages: reports, tree: treeWithTarget, rootPackageNames: depNames, targetPackage, trackedCount, missingCount, untrackedCount, untrackedFiles }
    };
  }

  // Check all packages and build reports (include workspace package so its resources are listed)
  for (const [pkgName, pkgEntry] of Object.entries(packages)) {
    try {
      const report = await checkPackageStatus(targetDir, pkgName, pkgEntry, includeFiles, platforms);
      reports.push(report);
      reportMap.set(pkgName, report);
    } catch (error) {
      logger.warn(`Failed to check package ${pkgName}: ${error}`);
      const errorReport: ListPackageReport = {
        name: pkgName,
        version: pkgEntry?.version,
        path: pkgEntry?.path ?? '',
        state: 'missing',
        totalFiles: 0,
        existingFiles: 0,
        dependencies: pkgEntry?.dependencies
      };
      reports.push(errorReport);
      reportMap.set(pkgName, errorReport);
    }
  }

  // Build dependency tree from root packages
  const tree = buildDependencyTree(rootPackageNames, reportMap, all);

  // Compute tracked/missing counts from reports
  const trackedCount = reports.reduce((sum, r) => sum + r.existingFiles, 0);
  const missingCount = reports.reduce((sum, r) => sum + (r.totalFiles - r.existingFiles), 0);

  // Scan untracked files unless --tracked flag is set
  let untrackedFiles: UntrackedScanResult | undefined;
  let untrackedCount = 0;
  if (!tracked) {
    untrackedFiles = await scanUntrackedFiles(targetDir, platforms);
    untrackedCount = untrackedFiles.totalFiles;
  }

  return {
    success: true,
    data: { packages: reports, tree, rootPackageNames, trackedCount, missingCount, untrackedCount, untrackedFiles }
  };
}
