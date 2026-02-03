import type { CommandResult } from '../../../types/index.js';
import type { InstallationContext } from './context.js';
import { loadPackagePhase } from './phases/load-package.js';
import { resolveDependenciesPhase } from './phases/resolve-dependencies.js';
import { processConflictsPhase } from './phases/conflicts.js';
import { executeInstallationPhase } from './phases/execute.js';
import { updateManifestPhase } from './phases/manifest.js';
import { reportResultsPhase } from './phases/report.js';
import { shouldResolveDependencies, shouldUpdateManifest } from './context-helpers.js';
import { logger } from '../../../utils/logger.js';
import { createWorkspacePackageYml } from '../../../utils/package-management.js';

function assertPipelineContextComplete(ctx: InstallationContext): void {
  if (!ctx.source.type) {
    throw new Error('Pipeline context invalid: ctx.source.type is required');
  }
  if (!ctx.source.packageName) {
    throw new Error('Pipeline context invalid: ctx.source.packageName must be set after load phase');
  }
  if (!ctx.source.contentRoot) {
    throw new Error('Pipeline context invalid: ctx.source.contentRoot must be set after load phase');
  }
  if (!Array.isArray(ctx.resolvedPackages) || ctx.resolvedPackages.length === 0) {
    throw new Error('Pipeline context invalid: ctx.resolvedPackages must contain a root package after load phase');
  }
  if (!ctx.resolvedPackages.some(p => (p as any).isRoot)) {
    throw new Error('Pipeline context invalid: ctx.resolvedPackages must contain an isRoot package');
  }
}

/**
 * Unified installation pipeline
 * 
 * Handles all installation scenarios (install, apply, bulk) with conditional phase execution
 * based on the context mode.
 * 
 * @param ctx - Installation context
 * @returns Command result
 */
export async function runUnifiedInstallPipeline(
  ctx: InstallationContext
): Promise<CommandResult> {
  logger.info(`Starting unified installation pipeline`, {
    mode: ctx.mode,
    sourceType: ctx.source.type,
    packageName: ctx.source.packageName
  });
  
  try {
    // Phase 0: Ensure workspace manifest exists (auto-create if needed)
    // Only for install mode, not apply mode (apply requires existing installation)
    if (ctx.mode === 'install') {
      await createWorkspacePackageYml(ctx.cwd);
    }
    
    // Phase 1: Load package from source (always)
    await loadPackagePhase(ctx);
    assertPipelineContextComplete(ctx);

    // Phase 2: Resolve dependencies (skip for apply mode)
    if (shouldResolveDependencies(ctx)) {
      await resolveDependenciesPhase(ctx);
    }
    
    // Phase 3: Process conflicts (always)
    const shouldProceed = await processConflictsPhase(ctx);
    if (!shouldProceed) {
      return createCancellationResult(ctx);
    }
    
    // Phase 4: Execute installation (always)
    const installResult = await executeInstallationPhase(ctx);
    
    // Check for complete failure
    if (installResult.hadErrors && !installResult.installedAnyFiles) {
      return {
        success: false,
        error: `Failed to install ${ctx.source.packageName}: ${ctx.errors.join('; ')}`
      };
    }
    
    // Phase 5: Update manifest (skip for apply)
    if (shouldUpdateManifest(ctx)) {
      await updateManifestPhase(ctx);
    }
    
    // Phase 6: Report results (always)
    return await reportResultsPhase(ctx, installResult);
    
  } catch (error) {
    logger.error(`Pipeline failed for ${ctx.source.packageName}:`, error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      warnings: ctx.warnings.length > 0 ? ctx.warnings : undefined
    };
  }
}

/**
 * Create result for user cancellation
 */
function createCancellationResult(ctx: InstallationContext): CommandResult {
  console.log(`Installation cancelled by user`);
  
  return {
    success: true,
    data: {
      packageName: ctx.source.packageName,
      installed: 0,
      skipped: 1,
      totalPackages: 0
    }
  };
}
