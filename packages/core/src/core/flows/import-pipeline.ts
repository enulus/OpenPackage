/**
 * Shared Import Pipeline
 *
 * Extracts the flow processing core that both install and sync-pull share.
 * Install uses the composable stages (to inject conflict resolution between
 * discovery and execution). Sync pull calls the composed function directly.
 *
 * Design: "Sync owns status classification and selectivity.
 *          Install's file processing pipeline owns the how."
 */

import type { Flow, FlowContext } from '../../types/flows.js';
import type { Platform } from '../platforms.js';
import type { PackageConversionContext } from '../../types/conversion-context.js';
import type { ExecutionResult } from './flow-execution-coordinator.js';
import { getPlatformDefinition, deriveRootDirFromFlows, platformUsesFlows } from '../platforms.js';
import { getApplicableFlows } from '../install/strategies/helpers/flow-helpers.js';
import { discoverFlowSources } from './flow-source-discovery.js';
import { executeFlowsForSources } from './flow-execution-coordinator.js';
import { filterSourcesByPlatform } from '../install/strategies/helpers/platform-filtering.js';
import { minimatch } from 'minimatch';
import { relative } from 'path';
import { deriveResourceLeafFromPackageName } from '../../utils/plugin-naming.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportPipelineContext {
  packageName: string;
  packageRoot: string;         // absolute path to package source
  workspaceRoot: string;       // cwd
  platform: Platform;
  packageVersion: string;
  priority: number;
  dryRun: boolean;
  conversionContext: PackageConversionContext;
  matchedPattern?: string;     // resource filtering (install only)
}

export interface ImportPipelineOptions {
  /** Sync's selectivity — only process these source keys. undefined = all. */
  sourceKeyFilter?: Set<string>;
}

export interface ImportPipelineResult {
  executionResult: ExecutionResult;
  /** Post-filter, pre-execution flow sources (for install's conflict resolver). */
  filteredFlowSources: Map<Flow, string[]>;
}

// ---------------------------------------------------------------------------
// Stage 1: Build FlowContext
// ---------------------------------------------------------------------------

/**
 * Build a FlowContext with standard variables from an ImportPipelineContext.
 *
 * This is the standalone equivalent of BaseStrategy.buildFlowContext().
 */
export function buildImportFlowContext(
  ctx: ImportPipelineContext,
  direction: 'install' | 'save' = 'install',
): FlowContext {
  const platformDef = getPlatformDefinition(ctx.platform, ctx.workspaceRoot);
  const resourceLeaf = deriveResourceLeafFromPackageName(ctx.packageName);

  // Use conversion context as single source of truth for original format
  const originalSource = ctx.conversionContext.originalFormat.platform || 'openpackage';

  return {
    workspaceRoot: ctx.workspaceRoot,
    packageRoot: ctx.packageRoot,
    platform: ctx.platform,
    packageName: ctx.packageName,
    direction,
    variables: {
      name: ctx.packageName,
      version: ctx.packageVersion,
      priority: ctx.priority,
      rootFile: platformDef.rootFile,
      rootDir: deriveRootDirFromFlows(platformDef),
      platform: ctx.platform,
      targetPlatform: ctx.platform,
      source: originalSource,
      sourcePlatform: originalSource,
      targetRoot: ctx.workspaceRoot,
      resourceLeaf,
    },
    dryRun: ctx.dryRun,
  };
}

// ---------------------------------------------------------------------------
// Stage 2: Discover and filter sources
// ---------------------------------------------------------------------------

/**
 * Discover flow sources, apply resource filtering, platform filtering,
 * and optional sourceKey scoping (for sync pull).
 *
 * Composes: discoverFlowSources -> applyResourceFiltering
 *           -> filterSourcesByPlatform -> filterToScope
 */
export async function discoverAndFilterSources(
  flows: Flow[],
  ctx: ImportPipelineContext,
  flowCtx: FlowContext,
  opts?: ImportPipelineOptions,
): Promise<Map<Flow, string[]>> {
  // 1. Discover sources
  const flowSources = await discoverFlowSources(flows, ctx.packageRoot, flowCtx);

  // 2. Apply resource filtering (matchedPattern-based)
  const resourceFiltered = applyResourceFiltering(
    flowSources,
    ctx.matchedPattern,
    ctx.packageRoot,
  );

  // 3. Filter by platform
  const platformFiltered = filterSourcesByPlatform(resourceFiltered, ctx.platform);

  // 4. Apply sourceKey scope filter (sync pull selectivity)
  if (opts?.sourceKeyFilter) {
    for (const [flow, sources] of platformFiltered) {
      const kept = sources.filter(s => opts.sourceKeyFilter!.has(s));
      if (kept.length > 0) {
        platformFiltered.set(flow, kept);
      } else {
        platformFiltered.delete(flow);
      }
    }
  }

  return platformFiltered;
}

// ---------------------------------------------------------------------------
// Stage 3: Execute flows
// ---------------------------------------------------------------------------

/**
 * Execute flows on resolved sources.
 * Thin wrapper around executeFlowsForSources.
 */
export async function executeImportFlows(
  flowSources: Map<Flow, string[]>,
  flowCtx: FlowContext,
): Promise<ExecutionResult> {
  return executeFlowsForSources(flowSources, flowCtx);
}

// ---------------------------------------------------------------------------
// Composed: Full pipeline (for sync pull)
// ---------------------------------------------------------------------------

/**
 * Full import pipeline for a single platform.
 *
 * Equivalent to what FlowBasedInstallStrategy.install() does minus conflict
 * resolution. Sync pull calls this; install uses the stages individually.
 */
export async function processFlowsForPackage(
  ctx: ImportPipelineContext,
  opts?: ImportPipelineOptions,
): Promise<ImportPipelineResult> {
  // Check if platform uses flows
  if (!platformUsesFlows(ctx.platform, ctx.workspaceRoot)) {
    return {
      executionResult: emptyExecutionResult(),
      filteredFlowSources: new Map(),
    };
  }

  // Get applicable flows
  const flows = getApplicableFlows(ctx.platform, ctx.workspaceRoot);
  if (flows.length === 0) {
    return {
      executionResult: emptyExecutionResult(),
      filteredFlowSources: new Map(),
    };
  }

  // Build context
  const flowCtx = buildImportFlowContext(ctx, 'install');

  // Discover and filter
  const filteredFlowSources = await discoverAndFilterSources(
    flows, ctx, flowCtx, opts,
  );

  // Execute
  const executionResult = await executeImportFlows(filteredFlowSources, flowCtx);

  return { executionResult, filteredFlowSources };
}

// ---------------------------------------------------------------------------
// Standalone resource filtering (extracted from BaseStrategy)
// ---------------------------------------------------------------------------

/**
 * Filter flow sources based on a matched pattern (from base detection or
 * resource scoping). Standalone version of BaseStrategy.applyResourceFiltering().
 */
export function applyResourceFiltering(
  flowSources: Map<Flow, string[]>,
  matchedPattern: string | undefined,
  packageRoot: string,
): Map<Flow, string[]> {
  if (!matchedPattern) {
    return flowSources;
  }

  const normalizedPattern = matchedPattern.replace(/\\/g, '/');
  const filteredSources = new Map<Flow, string[]>();

  for (const [flow, sources] of flowSources.entries()) {
    const filtered = sources.filter(sourcePath => {
      const isAbs = sourcePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(sourcePath);
      const normalizedSource = sourcePath.replace(/\\/g, '/');
      const relativePath = (
        isAbs ? relative(packageRoot, sourcePath) : normalizedSource
      ).replace(/\\/g, '/');

      return minimatch(relativePath, normalizedPattern);
    });

    if (filtered.length > 0) {
      filteredSources.set(flow, filtered);
    }
  }

  return filteredSources;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyExecutionResult(): ExecutionResult {
  return {
    success: true,
    filesProcessed: 0,
    filesWritten: 0,
    targetPaths: [],
    fileMapping: {},
    conflicts: [],
    errors: [],
    warnings: [],
  };
}
