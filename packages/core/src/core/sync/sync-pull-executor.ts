/**
 * Sync Pull Executor
 *
 * Delegates pull actions to the shared import pipeline so that synced files
 * go through the same flow transforms as install (map pipelines, format
 * conversion, markdown platform overrides, merge strategies, embed ops).
 *
 * Follows the same delegation pattern as sync-push-executor.ts, which
 * delegates to the save pipeline.
 */

import type { ExecutionContext } from '../../types/execution-context.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type { SyncFileAction, SyncFileResult, SyncOptions } from './sync-types.js';
import type { ExecutionResult } from '../flows/flow-execution-coordinator.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { getTargetPath, isComplexMapping } from '../../utils/workspace-index-helpers.js';
import { initPullPipelineContext, runPipelineForAllPlatforms } from './sync-pull-pipeline-runner.js';
import { logger } from '../../utils/logger.js';

/**
 * Execute pull actions by delegating to the shared import pipeline.
 */
export async function executePullActions(
  pullActions: SyncFileAction[],
  packageName: string,
  packageRoot: string,
  cwd: string,
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  options: SyncOptions,
  _ctx?: ExecutionContext,
): Promise<SyncFileResult[]> {
  if (pullActions.length === 0) return [];

  const sourceKeyFilter = new Set(pullActions.map(a => a.sourceKey));

  const init = await initPullPipelineContext(packageRoot, packageName, cwd, options.platforms);
  if (init.platforms.length === 0) {
    logger.debug('No platforms detected in workspace, nothing to pull');
    return pullActions.map(a => ({
      sourceKey: a.sourceKey,
      targetPath: a.targetPath,
      action: 'error' as const,
      detail: 'No platforms detected in workspace',
    }));
  }

  const aggregated = await runPipelineForAllPlatforms(
    init, packageName, packageRoot, cwd, options.dryRun, sourceKeyFilter,
  );

  const syncResults = translateToSyncResults(pullActions, aggregated);

  // Update workspace index hashes from pipeline results
  if (!options.dryRun) {
    const pulledSourceKeys = syncResults
      .filter(r => r.action === 'pulled')
      .map(r => r.sourceKey);

    if (pulledSourceKeys.length > 0) {
      await updatePullHashesFromPipeline(cwd, packageName, aggregated, pulledSourceKeys);
    }
  }

  return syncResults;
}

/**
 * Translate pipeline ExecutionResult into SyncFileResult[].
 */
function translateToSyncResults(
  pullActions: SyncFileAction[],
  executionResult: ExecutionResult,
): SyncFileResult[] {
  const results: SyncFileResult[] = [];
  const processedSourceKeys = new Set(Object.keys(executionResult.fileMapping));

  for (const action of pullActions) {
    if (processedSourceKeys.has(action.sourceKey)) {
      results.push({
        sourceKey: action.sourceKey,
        targetPath: action.targetPath,
        action: 'pulled',
        operation: 'updated',
      });
    } else if (executionResult.errors.some(e => e.sourcePath === action.sourceKey)) {
      const error = executionResult.errors.find(e => e.sourcePath === action.sourceKey);
      results.push({
        sourceKey: action.sourceKey,
        targetPath: action.targetPath,
        action: 'error',
        detail: error?.message || 'Flow execution failed',
      });
    } else {
      results.push({
        sourceKey: action.sourceKey,
        targetPath: action.targetPath,
        action: 'skipped',
        detail: 'No matching flow for this source key',
      });
    }
  }

  return results;
}

/**
 * Update workspace index hashes using hashes from pipeline results.
 */
async function updatePullHashesFromPipeline(
  cwd: string,
  packageName: string,
  executionResult: ExecutionResult,
  pulledSourceKeys: string[],
): Promise<void> {
  try {
    const pulledSet = new Set(pulledSourceKeys);
    const record = await readWorkspaceIndex(cwd);
    const pkg = record.index.packages?.[packageName];
    if (!pkg?.files) return;

    const pipelineMappings = executionResult.fileMapping;

    let updated = false;
    for (const [sourceKey, targets] of Object.entries(pkg.files)) {
      if (!pulledSet.has(sourceKey)) continue;
      if (!Array.isArray(targets)) continue;

      const pipelineEntries = pipelineMappings[sourceKey];
      if (!pipelineEntries) continue;

      const pipelineByTarget = new Map<string, WorkspaceIndexFileMapping>();
      for (const entry of pipelineEntries) {
        if (typeof entry === 'object' && entry !== null && 'target' in entry) {
          pipelineByTarget.set(entry.target, entry as WorkspaceIndexFileMapping);
        }
      }

      for (let i = 0; i < targets.length; i++) {
        const mapping = targets[i];
        const targetPath = getTargetPath(mapping);
        const pipelineMapping = pipelineByTarget.get(targetPath);
        if (!pipelineMapping) continue;

        const hash = pipelineMapping.hash;
        const sourceHash = pipelineMapping.sourceHash;

        if (hash || sourceHash) {
          if (isComplexMapping(mapping)) {
            if (hash) mapping.hash = hash;
            if (sourceHash) mapping.sourceHash = sourceHash;
            if (pipelineMapping.merge) mapping.merge = pipelineMapping.merge;
            if (pipelineMapping.keys) mapping.keys = pipelineMapping.keys;
          } else {
            const upgraded: WorkspaceIndexFileMapping = {
              target: mapping as string,
              ...(hash ? { hash } : {}),
              ...(sourceHash ? { sourceHash } : {}),
              ...(pipelineMapping.merge ? { merge: pipelineMapping.merge } : {}),
              ...(pipelineMapping.keys ? { keys: pipelineMapping.keys } : {}),
            };
            targets[i] = upgraded;
          }
          updated = true;
        }
      }
    }

    if (updated) {
      await writeWorkspaceIndex(record);
      logger.debug(`Updated workspace index hashes (pull) for ${packageName}`);
    }
  } catch (error) {
    logger.warn(`Failed to update pull hashes: ${error}`);
  }
}
