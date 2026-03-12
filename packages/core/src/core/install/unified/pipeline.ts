import type { CommandResult } from '../../../types/index.js';
import type { InstallationContext } from './context.js';
import type { UnifiedSpinner } from '../../ports/output.js';
import { loadPackagePhase } from './phases/load-package.js';
import { convertPhase } from './phases/convert.js';
import { processConflictsPhase } from './phases/conflicts.js';
import { executeInstallationPhase } from './phases/execute.js';
import { updateManifestPhase } from './phases/manifest.js';
import { reportResultsPhase } from './phases/report.js';
import { shouldUpdateManifest } from './context-helpers.js';
import { logger } from '../../../utils/logger.js';
import { createWorkspacePackageYml } from '../../package-management.js';
import { cleanupTempDirectory } from '../strategies/helpers/temp-directory.js';
import { resolveOutput, resolvePrompt } from '../../ports/resolve.js';
import { checkSubsumption, resolveSubsumption } from '../orchestrator/subsumption-resolver.js';
import {
  readManifestRangeForDependency,
  checkVersionConstraint,
  resolveVersionMismatch,
  updateManifestRange,
} from '../../sync/sync-version-checker.js';

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
 * Subsumption phase: detect and resolve overlapping installations.
 *
 * Runs after the load phase (so packageName is populated) and before convert.
 * Returns 'skip' when the incoming install is already covered by a broader
 * package, 'proceed' otherwise (including after resolving upgrade scenarios).
 *
 * Skipped when:
 * - force flag is set (user explicitly wants to reinstall)
 * - _subsumptionChecked is true (already filtered by runMultiContextPipeline)
 *
 * Exported for testability.
 */
export async function subsumptionPhase(ctx: InstallationContext): Promise<'proceed' | 'skip'> {
  if (ctx.options?.force || ctx._subsumptionChecked) {
    return 'proceed';
  }

  const result = await checkSubsumption(ctx.source, ctx.targetDir);

  switch (result.type) {
    case 'upgrade':
      await resolveSubsumption(result, ctx.execution);
      ctx._replacedResources = result.entriesToRemove.map(e => e.packageName);
      return 'proceed';

    case 'already-covered': {
      const out = resolveOutput(ctx.execution);
      const resourcePath = ctx.source.resourcePath ||
        ctx.source.packageName.replace(/^.*?\/[^/]+\/[^/]+\//, '');
      out.info(`Skipped: ${resourcePath} is already installed via ${result.coveringPackage}`);
      return 'skip';
    }

    case 'none':
    default:
      return 'proceed';
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
  
  const out = resolveOutput(ctx.execution);
  const displayName = ctx.source.packageName || 'package';
  let tempConversionRoot: string | null = null;

  // Spinner 1: covers phases 0–2 (workspace manifest, load, subsumption, convert).
  // Stopped before the conflict phase which may prompt the user.
  let spinner1: UnifiedSpinner | undefined;
  try {
    spinner1 = out.spinner();
    spinner1.start(`Installing ${displayName}`);

    // Phase 0: Ensure workspace manifest exists (auto-create if needed)
    // Only for install mode, not apply mode (apply requires existing installation)
    if (ctx.mode === 'install') {
      await createWorkspacePackageYml(ctx.targetDir);
    }

    // Phase 1: Load package from source (always)
    // Pass spinner1 so loadPackagePhase updates our message instead of creating its own.
    await loadPackagePhase(ctx, undefined, spinner1);

    // Assert context is complete after load phase
    assertPipelineContextComplete(ctx);

    // Phase 1.5: Subsumption — detect overlapping installations.
    // Must run after load (packageName is now set) and before convert (avoid wasted work).
    const subsumptionOutcome = await subsumptionPhase(ctx);
    if (subsumptionOutcome === 'skip') {
      spinner1.stop();
      return createAlreadyCoveredResult(ctx);
    }

    // Phase 1.7: Version constraint validation (mutable sources only).
    // Stop spinner before potential interactive prompt, restart after.
    if (ctx.source.type === 'path' || ctx.source.type === 'workspace') {
      spinner1.stop();
      await versionValidationPhase(ctx);
      spinner1 = out.spinner();
      spinner1.start(`Preparing ${ctx.source.packageName}`);
    }

    // Phase 2: Convert package format if needed.
    // After load phase, ctx.source.packageName is guaranteed set by assertPipelineContextComplete.
    spinner1.message(`Preparing ${ctx.source.packageName}`);
    await convertPhase(ctx);

    tempConversionRoot = ctx._tempConversionRoot ?? null;

    spinner1.stop(`Prepared ${ctx.source.packageName}`);
  } catch (error) {
    spinner1?.stop();
    // convertPhase may have created a temp dir before failing
    await cleanupTempDirectory(ctx._tempConversionRoot ?? null);
    throw error;
  }

  // Phases 4–7: wrapped in try/finally for temp directory cleanup.
  // cleanupTempDirectory(null) is a no-op, so this is safe even on early returns
  // before tempConversionRoot is set.
  let spinner2: UnifiedSpinner | undefined;
  try {
    // Phase 4: Process conflicts (may prompt — no spinner active)
    const shouldProceed = await processConflictsPhase(ctx);
    if (!shouldProceed) {
      return createCancellationResult(ctx);
    }

    // Spinner 2: covers phases 5–6 (file installation, manifest update).
    spinner2 = out.spinner();
    spinner2.start(`Installing ${ctx.source.packageName}`);

    // Phase 5: Execute installation (always)
    const installResult = await executeInstallationPhase(ctx);

    // Check for complete failure
    if (installResult.hadErrors && !installResult.installedAnyFiles) {
      spinner2.stop();
      return {
        success: false,
        error: `Failed to install ${ctx.source.packageName}: ${ctx.errors.join('; ')}`
      };
    }

    // Phase 6: Update manifest (skip for apply)
    if (shouldUpdateManifest(ctx)) {
      await updateManifestPhase(ctx);
    }

    spinner2.stop(`Installed ${ctx.source.packageName}`);

    // Phase 7: Report results (always)
    return await reportResultsPhase(ctx, installResult);

  } catch (error) {
    spinner2?.stop();

    logger.debug(`Pipeline failed for ${ctx.source.packageName}:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    out.error(`Failed to install ${ctx.source.packageName}: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
      warnings: ctx.warnings.length > 0 ? ctx.warnings : undefined
    };
  } finally {
    await cleanupTempDirectory(tempConversionRoot);
  }
}

/**
 * Create result for user cancellation
 */
function createCancellationResult(ctx: InstallationContext): CommandResult {
  const out = resolveOutput(ctx.execution);
  out.info('Installation cancelled by user');
  
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

/**
 * Create result when install is skipped because a covering package already exists.
 */
function createAlreadyCoveredResult(ctx: InstallationContext): CommandResult {
  return {
    success: true,
    data: {
      packageName: ctx.source.packageName,
      installed: 0,
      skipped: 1,
      reason: 'Already installed via broader package'
    }
  };
}

/**
 * Version validation phase for mutable sources.
 *
 * Checks if the source version satisfies the consumer's manifest range.
 * Uses the shared resolveVersionMismatch cascade (force/interactive/error).
 */
async function versionValidationPhase(ctx: InstallationContext): Promise<void> {
  const sourceVersion = ctx.source.version;
  if (!sourceVersion) return;

  const manifestRange = await readManifestRangeForDependency(
    ctx.targetDir, ctx.source.packageName,
  );
  const check = checkVersionConstraint(sourceVersion, manifestRange);

  if (check.status !== 'mismatch') return;

  const prompt = resolvePrompt(ctx.execution);
  const resolution = await resolveVersionMismatch(
    ctx.source.packageName, check, { force: ctx.options?.force }, prompt, 'install',
  );

  if (resolution.action === 'skip') {
    throw new Error(`Installation cancelled: version mismatch for ${ctx.source.packageName}`);
  }

  await updateManifestRange(ctx.targetDir, ctx.source.packageName, sourceVersion, resolution.newRange);
}
