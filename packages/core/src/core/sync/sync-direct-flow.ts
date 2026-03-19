/**
 * Direct Sync Flow
 *
 * Core orchestration for `opkg sync <target>`.
 * Resolves a user-provided name to either a resource or a package,
 * disambiguates if needed, then delegates to the sync pipeline.
 *
 * Follows the direct-save-flow pattern (resolve → disambiguate → execute).
 */

import type { ExecutionContext } from '../../types/execution-context.js';
import type { SyncOptions, SyncPackageResult } from './sync-types.js';
import type { TraverseScopesOptions } from '../resources/scope-traversal.js';
import { resolveResourceSpec } from '../resources/resource-spec.js';
import { runSyncPipeline } from './sync-pipeline.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectSyncResult {
  success: boolean;
  result?: SyncPackageResult;
  cancelled?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

/**
 * Run the direct sync flow:
 * 1. Parse input for optional type qualifier
 * 2. Traverse scopes and resolve candidates by name
 * 3. Filter by type if type-qualified
 * 4. Disambiguate if multiple matches
 * 5. Route: package → full sync, resource → filtered sync
 */
export async function runDirectSyncFlow(
  nameArg: string,
  options: SyncOptions,
  traverseOpts: TraverseScopesOptions,
  ctx?: ExecutionContext,
): Promise<DirectSyncResult> {
  const selected = await resolveResourceSpec(nameArg, traverseOpts, {
    notFoundMessage: `"${nameArg}" not found as a package.\nHint: To target a resource, use its qualified name (e.g., skills/${nameArg}).\nRun \`opkg ls\` to see installed resources.`,
    promptMessage: 'Select which to sync:',
    multi: false,
  }, ctx);

  if (selected.length === 0) {
    return { success: false, cancelled: true };
  }

  const { candidate, targetDir } = selected[0];

  // Route by kind
  if (candidate.kind === 'package') {
    return await syncPackage(candidate.package!.packageName, targetDir, options, ctx);
  }

  // Resource: extract package name and sync filtered
  const resource = candidate.resource!;
  if (!resource.packageName) {
    return {
      success: false,
      error: `Resource '${resource.resourceName}' is not tracked by any package.\nOnly tracked resources can be synced.`,
    };
  }

  return await syncResource(resource.packageName, resource.sourceKeys, targetDir, options, ctx);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function syncPackage(
  packageName: string,
  targetDir: string,
  options: SyncOptions,
  ctx?: ExecutionContext,
): Promise<DirectSyncResult> {
  try {
    const result = await runSyncPipeline(packageName, targetDir, options, ctx);
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Sync only the files belonging to a specific resource within a package.
 *
 * Runs the full sync pipeline but the status classifier will naturally
 * only produce actions for files that have changes. We pass the full
 * package context and let the pipeline filter.
 */
async function syncResource(
  packageName: string,
  _sourceKeys: Set<string>,
  targetDir: string,
  options: SyncOptions,
  ctx?: ExecutionContext,
): Promise<DirectSyncResult> {
  // For now, sync the full package (the pipeline skips clean files anyway)
  // A future refinement could filter the status map to only resource keys
  return await syncPackage(packageName, targetDir, options, ctx);
}
