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

export type PackageSyncState = 'synced' | 'partial' | 'missing';

export interface ListFileMapping {
  source: string;
  target: string;
  exists: boolean;
}

export interface ListPackageReport {
  name: string;
  version?: string;
  path: string;
  state: PackageSyncState;
  totalFiles: number;
  existingFiles: number;
  fileList?: ListFileMapping[];
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
 * Check package list status by verifying file existence
 * Does not compare content - only checks if expected files exist
 */
async function checkPackageStatus(
  targetDir: string,
  pkgName: string,
  entry: WorkspaceIndexPackage,
  includeFileList: boolean = false
): Promise<ListPackageReport> {
  const resolved = resolveDeclaredPath(entry.path, targetDir);
  const sourceRoot = resolved.absolute;

  // Check if source path exists
  const sourceExists = await exists(sourceRoot);
  
  if (!sourceExists) {
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

  for (const [sourceKey, targets] of Object.entries(filesMapping)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;

    for (const mapping of targets) {
      const targetPath = getTargetPath(mapping);
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

  return {
    name: pkgName,
    version: entry.version,
    path: entry.path,
    state,
    totalFiles,
    existingFiles,
    fileList: includeFileList ? fileList : undefined,
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

  // Get workspace config to find root packages and filter workspace itself
  let workspacePackageName: string | undefined;
  let rootPackageNames: string[] = [];
  try {
    const config = await parsePackageYml(manifestPath);
    workspacePackageName = config.name;
    
    // Root packages are those declared in dependencies/dev-dependencies
    const declaredDeps = [
      ...(config.dependencies || []),
      ...(config['dev-dependencies'] || [])
    ];
    rootPackageNames = declaredDeps.map(dep => dep.name);
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
      targetPackage = await checkPackageStatus(targetDir, packageName, pkgEntry, true);
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
        const depReport = await checkPackageStatus(targetDir, depName, depEntry, includeFiles);
        reportMap.set(depName, depReport);
      } catch (error) {
        logger.debug(`Failed to load dependency ${depName}: ${error}`);
      }
    }

    // If --all, recursively load nested dependencies
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
              const nestedReport = await checkPackageStatus(targetDir, nestedDepName, nestedEntry, includeFiles);
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
      data: { packages: reports, tree, rootPackageNames: depNames, targetPackage, trackedCount, missingCount, untrackedCount, untrackedFiles }
    };
  }

  // Check all packages and build reports
  for (const [pkgName, pkgEntry] of Object.entries(packages)) {
    // Skip the workspace package itself
    if (workspacePackageName && arePackageNamesEquivalent(pkgName, workspacePackageName)) {
      logger.debug(`Skipping workspace package '${pkgName}' in list`);
      continue;
    }

    try {
      const report = await checkPackageStatus(targetDir, pkgName, pkgEntry, includeFiles);
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
