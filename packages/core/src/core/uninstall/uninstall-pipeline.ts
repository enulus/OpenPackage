import path from 'path';

import type { CommandResult, UninstallOptions, ExecutionContext } from '../../types/index.js';
import { ValidationError } from '../../utils/errors.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath } from '../../utils/paths.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { removeWorkspaceIndexEntry, removeWorkspaceIndexFileKeys } from '../../utils/workspace-index-ownership.js';
import { processRootFileRemovals } from '../../utils/root-file-uninstaller.js';
import { exists, remove, walkFiles } from '../../utils/fs.js';
import { isDirKey } from '../../utils/package-index-yml.js';
import { removePackageFromOpenpackageYml } from '../../utils/package-management.js';
import { getPlatformRootFileNames } from '../../utils/platform-root-files.js';
import { getAllPlatforms } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import { removeFileMapping } from './flow-aware-uninstaller.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import { buildPreservedDirectoriesSet } from '../../utils/directory-preservation.js';
import { cleanupEmptyParents } from '../../utils/cleanup-empty-parents.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

interface ProcessFileMappingsOptions {
  dryRun?: boolean;
}

interface ProcessFileMappingsResult {
  removed: string[];
  updated: string[];
}

function isRootFileKey(key: string, rootNames: Set<string>): boolean {
  const normalized = key.replace(/\\/g, '/');
  return rootNames.has(normalized);
}

async function processFileMappings(
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  targetDir: string,
  packageName: string,
  rootNames: Set<string>,
  options: ProcessFileMappingsOptions = {}
): Promise<ProcessFileMappingsResult> {
  const removed: string[] = [];
  const updated: string[] = [];
  const seenPaths = new Set<string>();

  for (const [rawKey, mappings] of Object.entries(filesMapping || {})) {
    if (!Array.isArray(mappings) || mappings.length === 0) continue;

    const isDir = isDirKey(rawKey);

    if (isDir) {
      for (const mapping of mappings) {
        const targetPath = getTargetPath(mapping);
        const absDir = path.join(targetDir, targetPath);
        if (!(await exists(absDir))) continue;

        if (options.dryRun) {
          for await (const filePath of walkFiles(absDir)) {
            if (!seenPaths.has(filePath)) {
              seenPaths.add(filePath);
              removed.push(filePath);
            }
          }
        } else {
          const result = await removeFileMapping(targetDir, mapping, packageName);
          removed.push(...result.removed);
          updated.push(...result.updated);
        }
      }
      continue;
    }

    if (isRootFileKey(rawKey, rootNames)) {
      continue;
    }

    for (const mapping of mappings) {
      const targetPath = getTargetPath(mapping);
      const absPath = path.join(targetDir, targetPath);

      if (options.dryRun) {
        if (!seenPaths.has(absPath)) {
          seenPaths.add(absPath);
          removed.push(absPath);
        }
      } else {
        const result = await removeFileMapping(targetDir, mapping, packageName);
        removed.push(...result.removed);
        updated.push(...result.updated);
      }
    }
  }

  return { removed, updated };
}

export interface UninstallPipelineResult {
  removedFiles: string[];
  rootFilesUpdated: string[];
}

export async function runUninstallPipeline(
  packageName: string,
  options: UninstallOptions = {},
  execContext: ExecutionContext
): Promise<CommandResult<UninstallPipelineResult>> {
  // Use targetDir for uninstall operations
  const targetDir = execContext.targetDir;
  const openpkgDir = getLocalOpenPackageDir(targetDir);
  const manifestPath = getLocalPackageYmlPath(targetDir);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${targetDir}.`
    );
  }

  // Look up package by exact name provided by user (no normalization)
  const { index, path: indexPath } = await readWorkspaceIndex(targetDir);
  const pkgEntry = index.packages?.[packageName];

  if (!pkgEntry) {
    return { success: false, error: `Package '${packageName}' not found in workspace index.` };
  }

  const rootNames = getPlatformRootFileNames(getAllPlatforms(undefined, targetDir), targetDir);

  if (options.dryRun) {
    const out = resolveOutput(execContext);
    const plannedRemovals = await processFileMappings(
      pkgEntry.files || {},
      targetDir,
      packageName,
      rootNames,
      { dryRun: true }
    );
    const rootPlan = await processRootFileRemovals(targetDir, [packageName], { dryRun: true });
    out.info(`(dry-run) Would remove ${plannedRemovals.removed.length} files for ${packageName}`);
    for (const filePath of plannedRemovals.removed) {
      out.info(` - ${filePath}`);
    }
    if (rootPlan.updated.length > 0) {
      out.info(`Root files to update:`);
      rootPlan.updated.forEach(f => out.info(` - ${f}`));
    }
    return {
      success: true,
      data: {
        removedFiles: plannedRemovals.removed,
        rootFilesUpdated: rootPlan.updated
      }
    };
  }

  const { removed: deleted, updated } = await processFileMappings(
    pkgEntry.files || {},
    targetDir,
    packageName,
    rootNames,
    { dryRun: false }
  );

  const rootResult = await processRootFileRemovals(targetDir, [packageName]);

  // Update workspace index (migration will happen on write)
  removeWorkspaceIndexEntry(index, packageName);
  await writeWorkspaceIndex({ path: indexPath, index });

  // Update openpackage.yml (migration will happen on write)
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/f66bae36-2cc1-4c38-8529-d173654652f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uninstall-pipeline.ts:runUninstallPipeline',message:'calling removePackageFromOpenpackageYml',data:{packageName},timestamp:Date.now(),hypothesisId:'C',runId:'post-fix'})}).catch(()=>{});
  // #endregion
  await removePackageFromOpenpackageYml(targetDir, packageName);

  // Cleanup empty directories (preserve platform roots from detection patterns)
  const preservedDirs = buildPreservedDirectoriesSet(targetDir);
  // Convert relative paths to absolute paths for cleanup
  const deletedAbsolutePaths = deleted.map(relativePath => path.join(targetDir, relativePath));
  await cleanupEmptyParents(targetDir, deletedAbsolutePaths, preservedDirs);

  logger.info(`Uninstalled ${packageName}: removed ${deleted.length} files, updated ${updated.length} merged files`);

  return {
    success: true,
    data: {
      removedFiles: deleted,
      rootFilesUpdated: [...rootResult.updated, ...updated]
    }
  };
}

export async function runSelectiveUninstallPipeline(
  packageName: string,
  sourceKeysToRemove: Set<string>,
  options: UninstallOptions = {},
  execContext: ExecutionContext
): Promise<CommandResult<UninstallPipelineResult>> {
  const targetDir = execContext.targetDir;
  const openpkgDir = getLocalOpenPackageDir(targetDir);
  const manifestPath = getLocalPackageYmlPath(targetDir);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${targetDir}.`
    );
  }

  const { index, path: indexPath } = await readWorkspaceIndex(targetDir);
  const pkgEntry = index.packages?.[packageName];

  if (!pkgEntry) {
    return { success: false, error: `Package '${packageName}' not found in workspace index.` };
  }

  const filteredFiles: Record<string, (string | WorkspaceIndexFileMapping)[]> = {};
  for (const key of sourceKeysToRemove) {
    if (pkgEntry.files[key]) {
      filteredFiles[key] = pkgEntry.files[key];
    }
  }

  const rootNames = getPlatformRootFileNames(getAllPlatforms(undefined, targetDir), targetDir);

  if (options.dryRun) {
    const out = resolveOutput(execContext);
    const plannedRemovals = await processFileMappings(
      filteredFiles,
      targetDir,
      packageName,
      rootNames,
      { dryRun: true }
    );
    out.info(`(dry-run) Would remove ${plannedRemovals.removed.length} files for ${packageName}`);
    for (const filePath of plannedRemovals.removed) {
      out.info(` - ${filePath}`);
    }
    return {
      success: true,
      data: {
        removedFiles: plannedRemovals.removed,
        rootFilesUpdated: []
      }
    };
  }

  const { removed: deleted, updated } = await processFileMappings(
    filteredFiles,
    targetDir,
    packageName,
    rootNames,
    { dryRun: false }
  );

  removeWorkspaceIndexFileKeys(index, packageName, sourceKeysToRemove);
  await writeWorkspaceIndex({ path: indexPath, index });

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/f66bae36-2cc1-4c38-8529-d173654652f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uninstall-pipeline.ts:runSelectiveUninstallPipeline',message:'selective uninstall done - NO removePackageFromOpenpackageYml',data:{packageName},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  const preservedDirs = buildPreservedDirectoriesSet(targetDir);
  const deletedAbsolutePaths = deleted.map(relativePath => path.join(targetDir, relativePath));
  await cleanupEmptyParents(targetDir, deletedAbsolutePaths, preservedDirs);

  logger.info(`Selectively uninstalled from ${packageName}: removed ${deleted.length} files, updated ${updated.length} merged files`);

  return {
    success: true,
    data: {
      removedFiles: deleted,
      rootFilesUpdated: updated
    }
  };
}
