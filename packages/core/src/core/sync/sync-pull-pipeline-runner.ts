/**
 * Sync Pull Pipeline Runner
 *
 * Shared initialization and pipeline invocation logic for both
 * sync-pull-executor and sync-pull-new-executor. Avoids duplicating
 * platform detection, format detection, version reading, and the
 * per-platform pipeline loop.
 */

import type { PackageConversionContext } from '../../types/conversion-context.js';
import type { Platform } from '../platforms.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolvePlatforms } from '../install/platform-resolution.js';
import { detectFormatWithContextFromDirectory } from '../install/helpers/format-detection.js';
import {
  processFlowsForPackage,
  type ImportPipelineContext,
  type ImportPipelineOptions,
} from '../flows/import-pipeline.js';
import { aggregateExecutionResults, type ExecutionResult } from '../flows/flow-execution-coordinator.js';
import { logger } from '../../utils/logger.js';

export interface PullPipelineInit {
  platforms: Platform[];
  conversionContext: PackageConversionContext;
  packageVersion: string;
}

/**
 * Resolve the shared context needed by both pull executors:
 * detected platforms, conversion context, and package version.
 */
export async function initPullPipelineContext(
  packageRoot: string,
  packageName: string,
  cwd: string,
  specifiedPlatforms?: string[],
): Promise<PullPipelineInit> {
  const [platforms, { context: conversionContext }, packageVersion] = await Promise.all([
    resolvePlatforms(cwd, specifiedPlatforms),
    detectFormatWithContextFromDirectory(packageRoot),
    readPackageVersion(cwd, packageName),
  ]);

  return { platforms, conversionContext, packageVersion };
}

/**
 * Run the import pipeline for each detected platform with the given
 * sourceKeyFilter and return the aggregated ExecutionResult.
 */
export async function runPipelineForAllPlatforms(
  init: PullPipelineInit,
  packageName: string,
  packageRoot: string,
  cwd: string,
  dryRun: boolean,
  sourceKeyFilter: Set<string>,
): Promise<ExecutionResult> {
  const allResults: ExecutionResult[] = [];

  for (const platform of init.platforms) {
    const pipelineCtx: ImportPipelineContext = {
      packageName,
      packageRoot,
      workspaceRoot: cwd,
      platform,
      packageVersion: init.packageVersion,
      priority: 0,
      dryRun,
      conversionContext: init.conversionContext,
    };

    try {
      const { executionResult } = await processFlowsForPackage(pipelineCtx, { sourceKeyFilter });
      allResults.push(executionResult);
    } catch (error) {
      logger.debug(`Pipeline failed for platform ${platform}: ${error}`);
    }
  }

  return aggregateExecutionResults(allResults);
}

async function readPackageVersion(cwd: string, packageName: string): Promise<string> {
  try {
    const wsRecord = await readWorkspaceIndex(cwd);
    return wsRecord.index.packages?.[packageName]?.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
