/**
 * Move Cleanup
 *
 * Post-add cleanup logic for `--move`. Removes the resource from its origin
 * package source and uninstalls it from the workspace.
 */

import { join } from 'path';

import type { ExecutionContext } from '../../types/index.js';
import type { ResolvedResource } from '../resources/resource-builder.js';
import { collectRemovalEntries } from '../remove/removal-collector.js';
import { runSelectiveUninstallPipeline } from '../uninstall/uninstall-pipeline.js';
import { remove, exists } from '../../utils/fs.js';
import { cleanupEmptyParents } from '../../utils/cleanup-empty-parents.js';
import { buildPreservedDirectoriesSet } from '../platform/directory-preservation.js';
import { logger } from '../../utils/logger.js';

export interface MoveCleanupContext {
  resource: ResolvedResource;
  packageSourcePath: string | undefined;
  execContext: ExecutionContext;
}

export interface MoveCleanupResult {
  sourceFilesRemoved: string[];
  workspaceFilesRemoved: string[];
}

/**
 * Remove the resource from its origin after it has been added to the destination.
 *
 * - Tracked resources: remove from origin package source + selective uninstall from workspace
 * - Untracked resources: direct file deletion from workspace
 */
export async function performMoveCleanup(ctx: MoveCleanupContext): Promise<MoveCleanupResult> {
  const { resource, packageSourcePath, execContext } = ctx;
  const sourceFilesRemoved: string[] = [];
  const workspaceFilesRemoved: string[] = [];

  if (resource.kind === 'tracked' && packageSourcePath && resource.packageName) {
    // 1. Remove from origin package source
    for (const sourceKey of resource.sourceKeys) {
      try {
        const removalEntries = await collectRemovalEntries(packageSourcePath, sourceKey);
        for (const entry of removalEntries) {
          if (await exists(entry.packagePath)) {
            await remove(entry.packagePath);
            sourceFilesRemoved.push(entry.registryPath);
          }
        }
      } catch (error) {
        // Source key may not exist in package source (e.g. already removed)
        logger.debug(`Move cleanup: skipping source key "${sourceKey}"`, { error });
      }
    }

    // Cleanup empty parent directories in package source
    if (sourceFilesRemoved.length > 0) {
      const deletedAbsPaths = sourceFilesRemoved.map(rp => join(packageSourcePath, rp));
      await cleanupEmptyParents(packageSourcePath, deletedAbsPaths);
    }

    // 2. Uninstall from workspace
    const uninstallResult = await runSelectiveUninstallPipeline(
      resource.packageName,
      resource.sourceKeys,
      {},
      execContext
    );
    if (uninstallResult.success && uninstallResult.data) {
      workspaceFilesRemoved.push(...uninstallResult.data.removedFiles);
    }
  } else {
    // Untracked resource — direct file deletion from workspace
    const targetDir = execContext.targetDir;

    for (const targetFile of resource.targetFiles) {
      const absPath = join(targetDir, targetFile);
      if (await exists(absPath)) {
        await remove(absPath);
        workspaceFilesRemoved.push(targetFile);
      }
    }

    // Cleanup empty parent directories
    if (workspaceFilesRemoved.length > 0) {
      const preservedDirs = buildPreservedDirectoriesSet(targetDir);
      const deletedAbsPaths = workspaceFilesRemoved.map(f => join(targetDir, f));
      await cleanupEmptyParents(targetDir, deletedAbsPaths, preservedDirs);
    }
  }

  return { sourceFilesRemoved, workspaceFilesRemoved };
}
