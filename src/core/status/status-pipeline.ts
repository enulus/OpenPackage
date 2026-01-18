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

export type PackageSyncState = 'synced' | 'partial' | 'missing';

export interface StatusPackageReport {
  name: string;
  version?: string;
  path: string;
  state: PackageSyncState;
  totalFiles: number;
  existingFiles: number;
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
  entry: WorkspaceIndexPackage
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
      existingFiles: 0
    };
  }

  // Check workspace file existence
  let totalFiles = 0;
  let existingFiles = 0;
  
  const filesMapping = entry.files || {};

  for (const [_sourceKey, targets] of Object.entries(filesMapping)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;

    for (const mapping of targets) {
      const targetPath = getTargetPath(mapping);
      const absPath = path.join(cwd, targetPath);
      totalFiles++;
      
      if (await exists(absPath)) {
        existingFiles++;
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
    existingFiles
  };
}

export async function runStatusPipeline(): Promise<CommandResult<StatusPipelineResult>> {
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

  for (const [pkgName, pkgEntry] of Object.entries(packages)) {
    try {
      const report = await checkPackageStatus(cwd, pkgName, pkgEntry);
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

  return {
    success: true,
    data: { packages: reports }
  };
}
