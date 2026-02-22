import type { CommandResult } from '../../../../types/index.js';
import type { InstallationContext } from '../context.js';
import type { ExecutionResult } from './execute.js';
import { displayInstallationResults } from '../../install-reporting.js';
import { getInstallRootDir } from '../../../../utils/paths.js';
import { resolveOutput } from '../../../ports/resolve.js';

/**
 * Report results phase
 */
export async function reportResultsPhase(
  ctx: InstallationContext,
  installResult: ExecutionResult
): Promise<CommandResult> {
  const mainPackage = ctx.resolvedPackages.find(pkg => pkg.isRoot);
  
  // Display results (only show "dependency recorded" for dependency installs, not workspace-root)
  const isDependencyInstall = ctx.source.type !== 'workspace';
  displayInstallationResults({
    packageName: ctx.source.packageName,
    resolvedPackages: ctx.resolvedPackages,
    platformResult: { platforms: ctx.platforms, created: [] },
    options: ctx.options,
    mainPackage,
    installedFiles: installResult.allAddedFiles,
    updatedFiles: installResult.allUpdatedFiles,
    rootFileResults: installResult.rootFileResults,
    missingPackages: [],
    missingPackageOutcomes: {},
    errorCount: installResult.errorCount,
    errors: installResult.errors,
    isDependencyInstall,
    namespaced: installResult.namespaced,
    relocatedFiles: installResult.relocatedFiles,
    interactive: ctx.execution.interactionPolicy?.isTTY ?? false,
  }, resolveOutput(ctx.execution));
  
  // Build result data
  return {
    success: true,
    data: {
      packageName: ctx.source.packageName,
      targetDir: getInstallRootDir(ctx.targetDir),
      resolvedPackages: ctx.resolvedPackages,
      totalPackages: ctx.resolvedPackages.length,
      installed: installResult.installedCount,
      skipped: installResult.skippedCount,
      totalOpenPackageFiles: installResult.installedCount + installResult.allUpdatedFiles.length
    },
    warnings: ctx.warnings.length > 0 ? Array.from(new Set(ctx.warnings)) : undefined
  };
}
