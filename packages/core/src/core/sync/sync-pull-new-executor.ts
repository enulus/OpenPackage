/**
 * Sync Pull-New Executor
 *
 * Handles installing newly detected source files into the workspace
 * by delegating to the shared import pipeline (same transforms as install).
 * Updates the workspace index with proper dual hashes from pipeline results.
 */

import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type { SyncFileResult, SyncOptions } from './sync-types.js';
import type { NewSourceFileEntry } from './sync-source-scanner.js';
import type { ExecutionResult } from '../flows/flow-execution-coordinator.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { initPullPipelineContext, runPipelineForAllPlatforms } from './sync-pull-pipeline-runner.js';
import { logger } from '../../utils/logger.js';

/**
 * Pull new source files into the workspace and update the index.
 */
export async function executePullNewActions(
  newFiles: NewSourceFileEntry[],
  packageName: string,
  packageRoot: string,
  cwd: string,
  options: SyncOptions,
): Promise<SyncFileResult[]> {
  if (newFiles.length === 0) return [];

  const sourceKeyFilter = new Set(newFiles.map(f => f.registryPath));

  const init = await initPullPipelineContext(packageRoot, packageName, cwd, options.platforms);
  if (init.platforms.length === 0) {
    return newFiles.flatMap(entry =>
      entry.targetPaths.map(tp => ({
        sourceKey: entry.registryPath,
        targetPath: tp,
        action: 'error' as const,
        detail: 'No platforms detected in workspace',
      }))
    );
  }

  const aggregated = await runPipelineForAllPlatforms(
    init, packageName, packageRoot, cwd, options.dryRun, sourceKeyFilter,
  );

  // Translate to SyncFileResult[]
  const results: SyncFileResult[] = [];
  const processedSourceKeys = new Set(Object.keys(aggregated.fileMapping));

  for (const entry of newFiles) {
    for (const targetPath of entry.targetPaths) {
      if (processedSourceKeys.has(entry.registryPath)) {
        results.push({
          sourceKey: entry.registryPath,
          targetPath,
          action: 'pulled',
          operation: 'created',
        });
      } else {
        results.push({
          sourceKey: entry.registryPath,
          targetPath,
          action: 'skipped',
          detail: 'No matching flow for this new source file',
        });
      }
    }
  }

  // Update workspace index with new entries from pipeline results
  if (!options.dryRun) {
    const pulledKeys = new Set(
      results.filter(r => r.action === 'pulled').map(r => r.sourceKey),
    );

    if (pulledKeys.size > 0) {
      await updateIndexWithNewFiles(cwd, packageName, aggregated, pulledKeys);
    }
  }

  return results;
}

/**
 * Update workspace index with new file entries, using hashes from pipeline.
 */
async function updateIndexWithNewFiles(
  cwd: string,
  packageName: string,
  executionResult: ExecutionResult,
  pulledKeys: Set<string>,
): Promise<void> {
  try {
    const record = await readWorkspaceIndex(cwd);
    const pkg = record.index.packages?.[packageName];
    if (!pkg) return;

    if (!pkg.files) pkg.files = {};

    let addedCount = 0;

    for (const [sourceKey, pipelineEntries] of Object.entries(executionResult.fileMapping)) {
      if (!pulledKeys.has(sourceKey)) continue;

      // Check for collision: skip if already owned by another package
      let collision = false;
      for (const [otherPkg, otherEntry] of Object.entries(record.index.packages ?? {})) {
        if (otherPkg === packageName) continue;
        if (otherEntry.files?.[sourceKey]) {
          logger.debug(
            `Skipping new-file index entry for ${sourceKey}: already owned by ${otherPkg}`,
          );
          collision = true;
          break;
        }
      }
      if (collision) continue;

      // Build index entries from pipeline mappings
      const mappings: (string | WorkspaceIndexFileMapping)[] = [];
      for (const entry of pipelineEntries) {
        if (typeof entry === 'object' && entry !== null && 'target' in entry) {
          mappings.push(entry as WorkspaceIndexFileMapping);
        } else if (typeof entry === 'string') {
          mappings.push(entry);
        }
      }

      if (mappings.length > 0) {
        if (!pkg.files[sourceKey]) {
          pkg.files[sourceKey] = mappings;
        } else {
          pkg.files[sourceKey].push(...mappings);
        }
        addedCount++;
      }
    }

    if (addedCount > 0) {
      await writeWorkspaceIndex(record);
      logger.debug(`Added ${addedCount} new file(s) to workspace index for ${packageName}`);
    }
  } catch (error) {
    logger.warn(`Failed to update workspace index with new files: ${error}`);
  }
}
