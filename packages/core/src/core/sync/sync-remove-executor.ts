/**
 * Sync Remove Executor
 *
 * Removes workspace files for stale index entries where the source file
 * has been deleted. Reuses existing uninstall building blocks.
 */

import path from 'path';

import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type { SyncFileAction, SyncFileResult, SyncOptions } from './sync-types.js';
import { removeFileMapping } from '../uninstall/flow-aware-uninstaller.js';
import { removeWorkspaceIndexFileKeys } from '../../utils/workspace-index-ownership.js';
import { buildPreservedDirectoriesSet } from '../platform/directory-preservation.js';
import { cleanupEmptyParents } from '../../utils/cleanup-empty-parents.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { logger } from '../../utils/logger.js';

/**
 * Execute remove actions — delete stale workspace files and clean up index.
 *
 * @param removeActions - File actions classified as remove (source-deleted)
 * @param packageName - Package being synced
 * @param cwd - Workspace root
 * @param filesMapping - Complete file mappings from workspace index
 * @param options - Sync options (dryRun, etc.)
 * @returns Array of SyncFileResult for removed files
 */
export async function executeRemoveActions(
  removeActions: SyncFileAction[],
  packageName: string,
  cwd: string,
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  options: SyncOptions,
): Promise<SyncFileResult[]> {
  if (removeActions.length === 0) return [];

  const results: SyncFileResult[] = [];
  const removedSourceKeys = new Set<string>();
  const allDeletedPaths: string[] = [];

  for (const action of removeActions) {
    const { sourceKey, targetPath } = action;

    if (options.dryRun) {
      results.push({
        sourceKey,
        targetPath,
        action: 'removed',
        detail: '(dry-run)',
      });
      removedSourceKeys.add(sourceKey);
      continue;
    }

    try {
      const targets = filesMapping[sourceKey];
      if (!targets || !Array.isArray(targets)) {
        results.push({
          sourceKey,
          targetPath,
          action: 'error',
          detail: 'No mapping found in workspace index',
        });
        continue;
      }

      // Find the specific mapping for this targetPath
      const mapping = targets.find(m => {
        const tp = typeof m === 'string' ? m : m.target;
        return tp === targetPath;
      });

      if (!mapping) {
        results.push({
          sourceKey,
          targetPath,
          action: 'error',
          detail: 'Mapping entry not found for target path',
        });
        continue;
      }

      const removeResult = await removeFileMapping(cwd, mapping, packageName);
      allDeletedPaths.push(...removeResult.removed.map(p => path.resolve(cwd, p)));
      removedSourceKeys.add(sourceKey);

      results.push({
        sourceKey,
        targetPath,
        action: 'removed',
      });
    } catch (error) {
      logger.debug(`Remove failed for ${sourceKey}: ${error}`);
      results.push({
        sourceKey,
        targetPath,
        action: 'error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Update workspace index and clean up empty directories
  if (!options.dryRun && removedSourceKeys.size > 0) {
    try {
      const record = await readWorkspaceIndex(cwd);
      removeWorkspaceIndexFileKeys(record.index, packageName, removedSourceKeys);
      await writeWorkspaceIndex(record);
      logger.debug(`Removed ${removedSourceKeys.size} source key(s) from workspace index for ${packageName}`);
    } catch (error) {
      logger.warn(`Failed to update workspace index after removal: ${error}`);
    }

    if (allDeletedPaths.length > 0) {
      try {
        const preserved = buildPreservedDirectoriesSet(cwd);
        await cleanupEmptyParents(cwd, allDeletedPaths, preserved);
      } catch (error) {
        logger.warn(`Failed to clean up empty parents: ${error}`);
      }
    }
  }

  return results;
}
