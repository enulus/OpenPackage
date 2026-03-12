import path from 'path';

import type { CommandResult, ExecutionContext } from '../../types/index.js';
import { ValidationError } from '../../utils/errors.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath } from '../../utils/paths.js';
import { readWorkspaceIndex, getWorkspaceIndexPath } from '../../utils/workspace-index-yml.js';
import { healAndPersistIndex } from '../../utils/workspace-index-healer.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { exists } from '../../utils/fs.js';
import type { WorkspaceIndexPackage } from '../../types/workspace-index.js';
import { logger } from '../../utils/logger.js';
import { getTargetPath, findPackageInIndex } from '../../utils/workspace-index-helpers.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { scanUntrackedFiles, type UntrackedScanResult } from './untracked-files-scanner.js';
import { checkContentStatus, applyPendingHashUpdates } from './content-status-checker.js';
import { isRegistryPath } from '../source-mutability.js';
import { normalizePlatforms } from '../platform/platform-mapper.js';
import { extractPlatformFromPath } from '../platform/platform-path-utils.js';
import { RESOURCE_TYPE_ORDER, toPluralKey, type ResourceTypeId } from '../resources/resource-registry.js';
import { classifySourceKeyBatch } from '../resources/resource-classifier.js';
import { loadMarketplaceManifest } from '../install/plugin-detector.js';

export type PackageSyncState = 'synced' | 'partial' | 'missing';

export interface ListFileMapping {
  source: string;
  target: string;
  exists: boolean;
  contentStatus?: 'modified' | 'clean' | 'outdated' | 'diverged' | 'merged' | 'source-deleted';
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
  modifiedCount?: number;
  outdatedCount?: number;
  divergedCount?: number;
  sourceDeletedCount?: number;
  isRegistryPackage?: boolean;
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
  /** Show content change status (modified/clean) */
  status?: boolean;
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
 * Group file mappings into resource groups by analyzing source keys.
 *
 * For skills, all files sharing the same skills/<name>/ prefix are grouped into one resource.
 * For other types, each source key maps to one resource.
 */
export function groupFilesIntoResources(fileList: ListFileMapping[]): ListResourceGroup[] {
  // Batch-classify all source keys (handles marker boundaries internally)
  const classified = classifySourceKeyBatch(fileList.map(f => f.source));

  // First pass: group files by resource identity
  const resourceMap = new Map<string, ListResourceInfo>();

  for (const file of fileList) {
    const cls = classified.get(file.source)!;
    const key = cls.fullName;

    if (!resourceMap.has(key)) {
      resourceMap.set(key, {
        name: cls.fullName,
        resourceType: cls.resourceType,
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
 * Append marketplace plugin entries as a resource group.
 * Plugins are metadata-only entries from .claude-plugin/marketplace.json,
 * not files, so they must be appended after file-based grouping.
 */
export async function appendMarketplacePluginGroup(
  resourceGroups: ListResourceGroup[] | undefined,
  packageDir: string,
): Promise<ListResourceGroup[] | undefined> {
  const marketplace = await loadMarketplaceManifest(packageDir);
  if (!marketplace || marketplace.plugins.length === 0) return resourceGroups;

  const pluginGroup: ListResourceGroup = {
    resourceType: 'plugins',
    resources: marketplace.plugins.map(p => ({
      name: `plugins/${p.name}`,
      resourceType: 'plugins',
      files: [],
    })),
  };
  const groups = resourceGroups ?? [];
  groups.push(pluginGroup);
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
  platformsFilter?: string[],
  statusEnabled?: boolean
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

  // When status is enabled, we always need the file list to annotate
  if (statusEnabled) {
    includeFileList = true;
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

  // Content status comparison (when --status is active and source exists)
  let modifiedCount: number | undefined;
  let outdatedCount: number | undefined;
  let divergedCount: number | undefined;
  let sourceDeletedCount: number | undefined;
  let isRegistryPackageFlag: boolean | undefined;
  if (statusEnabled && sourceExists) {
    isRegistryPackageFlag = isRegistryPath(sourceRoot);
    try {
      const { statusMap, pendingHashUpdates } = await checkContentStatus(targetDir, sourceRoot, filesMapping);
      let modified = 0;
      let outdated = 0;
      let diverged = 0;
      let sourceDeleted = 0;
      for (const file of fileList) {
        const key = `${file.source}::${file.target}`;
        const cs = statusMap.get(key);
        if (cs) {
          file.contentStatus = cs;
          if (cs === 'modified') modified++;
          if (cs === 'outdated') outdated++;
          if (cs === 'diverged') diverged++;
          if (cs === 'source-deleted') sourceDeleted++;
        }
      }
      modifiedCount = modified;
      outdatedCount = outdated;
      divergedCount = diverged;
      sourceDeletedCount = sourceDeleted;

      // Apply hash pivot recovery (best-effort side effect during list)
      if (pendingHashUpdates.size > 0) {
        try {
          await applyPendingHashUpdates(targetDir, pkgName, pendingHashUpdates);
        } catch (error) {
          logger.warn(`Failed to apply hash pivot recovery for ${pkgName}: ${error}`);
        }
      }
    } catch (error) {
      logger.debug(`Content status check failed for ${pkgName}: ${error}`);
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
    dependencies,
    modifiedCount,
    outdatedCount,
    divergedCount,
    sourceDeletedCount,
    isRegistryPackage: isRegistryPackageFlag
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
  const { includeFiles = false, all = false, status = false, platforms } = options;

  // Use targetDir for list operations
  const targetDir = execContext.targetDir;

  // Regular list operation - require both index and manifest
  const openpkgDir = getLocalOpenPackageDir(targetDir);
  const manifestPath = getLocalPackageYmlPath(targetDir);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${targetDir}.`
    );
  }

  const { index } = await readWorkspaceIndex(targetDir);

  // Self-heal stale index entries when status checking is enabled
  if (status) {
    await healAndPersistIndex(targetDir, index, getWorkspaceIndexPath(targetDir));
  }

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
    const match = findPackageInIndex(packageName, packages);
    if (!match) {
      return {
        success: true,
        data: { packages: [], rootPackageNames: [], trackedCount: 0, missingCount: 0, untrackedCount: 0 }
      };
    }

    const resolvedName = match.key;
    const pkgEntry = match.entry;

    let targetPackage: ListPackageReport;
    try {
      targetPackage = await checkPackageStatus(targetDir, resolvedName, pkgEntry, true, platforms, status);
      reports.push(targetPackage);
      reportMap.set(resolvedName, targetPackage);
    } catch (error) {
      logger.warn(`Failed to check package ${resolvedName}: ${error}`);
      targetPackage = {
        name: resolvedName,
        version: pkgEntry?.version,
        path: pkgEntry?.path ?? '',
        state: 'missing',
        totalFiles: 0,
        existingFiles: 0,
        fileList: [],
        dependencies: pkgEntry?.dependencies
      };
      reports.push(targetPackage);
      reportMap.set(resolvedName, targetPackage);
    }

    // Load the target package's dependencies as tree nodes
    const depNames = targetPackage.dependencies || [];
    for (const depName of depNames) {
      if (reportMap.has(depName)) continue;
      
      const depEntry = packages[depName];
      if (!depEntry) continue;
      
      try {
        const depReport = await checkPackageStatus(targetDir, depName, depEntry, includeFiles, platforms, status);
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
              const nestedReport = await checkPackageStatus(targetDir, nestedDepName, nestedEntry, includeFiles, platforms, status);
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

    // Scan untracked files
    let untrackedFiles: UntrackedScanResult | undefined;
    let untrackedCount = 0;
    try {
      untrackedFiles = await scanUntrackedFiles(targetDir, platforms);
      untrackedCount = untrackedFiles.totalFiles;
    } catch (error) {
      logger.warn('Failed to scan untracked files', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      success: true,
      data: { packages: reports, tree: treeWithTarget, rootPackageNames: depNames, targetPackage, trackedCount, missingCount, untrackedCount, untrackedFiles }
    };
  }

  // Check all packages and build reports (include workspace package so its resources are listed)
  for (const [pkgName, pkgEntry] of Object.entries(packages)) {
    try {
      const report = await checkPackageStatus(targetDir, pkgName, pkgEntry, includeFiles, platforms, status);
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

  // Scan untracked files
  let untrackedFiles: UntrackedScanResult | undefined;
  let untrackedCount = 0;
  try {
    untrackedFiles = await scanUntrackedFiles(targetDir, platforms);
    untrackedCount = untrackedFiles.totalFiles;
  } catch (error) {
    logger.warn('Failed to scan untracked files', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    success: true,
    data: { packages: reports, tree, rootPackageNames, trackedCount, missingCount, untrackedCount, untrackedFiles }
  };
}
