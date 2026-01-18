import path from 'path';

import type { CommandResult } from '../../types/index.js';
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

export type PackageSyncState = 'synced' | 'partial' | 'missing';

export interface StatusFileMapping {
  source: string;
  target: string;
  exists: boolean;
}

export interface StatusPackageReport {
  name: string;
  version?: string;
  path: string;
  state: PackageSyncState;
  totalFiles: number;
  existingFiles: number;
  fileList?: StatusFileMapping[];
}

export interface StatusPipelineResult {
  packages: StatusPackageReport[];
}

/**
 * Check package status by verifying file existence
 * Does not compare content - only checks if expected files exist
 */
async function checkPackageStatus(
  cwd: string,
  pkgName: string,
  entry: WorkspaceIndexPackage,
  includeFileList: boolean = false
): Promise<StatusPackageReport> {
  const resolved = resolveDeclaredPath(entry.path, cwd);
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
  const fileList: StatusFileMapping[] = [];
  
  const filesMapping = entry.files || {};

  for (const [sourceKey, targets] of Object.entries(filesMapping)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;

    for (const mapping of targets) {
      const targetPath = getTargetPath(mapping);
      const absPath = path.join(cwd, targetPath);
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

  return {
    name: pkgName,
    version: entry.version,
    path: entry.path,
    state,
    totalFiles,
    existingFiles,
    fileList: includeFileList ? fileList : undefined
  };
}

export async function runStatusPipeline(packageName?: string): Promise<CommandResult<StatusPipelineResult>> {
  const cwd = process.cwd();
  const openpkgDir = getLocalOpenPackageDir(cwd);
  const manifestPath = getLocalPackageYmlPath(cwd);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${cwd}.`
    );
  }

  const { index } = await readWorkspaceIndex(cwd);
  const packages = index.packages || {};
  const reports: StatusPackageReport[] = [];

  // Get workspace package name to filter it out
  let workspacePackageName: string | undefined;
  try {
    const config = await parsePackageYml(manifestPath);
    workspacePackageName = config.name;
  } catch (error) {
    logger.warn(`Failed to read workspace manifest: ${error}`);
  }

  // If specific package requested, only check that one with file list
  if (packageName) {
    const pkgEntry = packages[packageName];
    if (!pkgEntry) {
      return {
        success: true,
        data: { packages: [] }
      };
    }

    try {
      const report = await checkPackageStatus(cwd, packageName, pkgEntry, true);
      reports.push(report);
    } catch (error) {
      logger.warn(`Failed to compute status for ${packageName}: ${error}`);
      reports.push({
        name: packageName,
        version: pkgEntry?.version,
        path: pkgEntry?.path ?? '',
        state: 'missing',
        totalFiles: 0,
        existingFiles: 0,
        fileList: []
      });
    }
  } else {
    // Otherwise check all packages without file list
    for (const [pkgName, pkgEntry] of Object.entries(packages)) {
      // Skip the workspace package itself
      if (workspacePackageName && arePackageNamesEquivalent(pkgName, workspacePackageName)) {
        logger.debug(`Skipping workspace package '${pkgName}' in status list`);
        continue;
      }

      try {
        const report = await checkPackageStatus(cwd, pkgName, pkgEntry, false);
        reports.push(report);
      } catch (error) {
        logger.warn(`Failed to compute status for ${pkgName}: ${error}`);
        reports.push({
          name: pkgName,
          version: pkgEntry?.version,
          path: pkgEntry?.path ?? '',
          state: 'missing',
          totalFiles: 0,
          existingFiles: 0
        });
      }
    }
  }

  return {
    success: true,
    data: { packages: reports }
  };
}
