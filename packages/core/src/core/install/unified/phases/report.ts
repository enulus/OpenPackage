import type { CommandResult } from '../../../../types/index.js';
import type { InstallationContext } from '../context.js';
import type { ExecutionResult } from './execute.js';
import type { InstallReportData } from '../../install-reporting.js';
import { displayInstallationResults } from '../../install-reporting.js';
import { getInstallRootDir } from '../../../../utils/paths.js';
import { resolveOutput } from '../../../ports/resolve.js';

/**
 * Report results phase
 */
export async function reportResultsPhase(
  ctx: InstallationContext,
  installResult: ExecutionResult
): Promise<CommandResult & { _reportData?: InstallReportData }> {
  const mainPackage = ctx.resolvedPackages.find(pkg => pkg.isRoot);

  // Display results (only show "dependency recorded" for dependency installs, not workspace-root)
  const isDependencyInstall = ctx.source.type !== 'workspace';
  const reportData: InstallReportData = {
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
    interactive: ctx.execution.interactionPolicy?.mode === 'always',
    replacedResources: ctx._replacedResources,
  };

  if (ctx._deferredReport) {
    // Caller will merge and display (e.g. runMultiContextPipeline groupReport)
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
      warnings: ctx.warnings.length > 0 ? Array.from(new Set(ctx.warnings)) : undefined,
      _reportData: reportData
    };
  }

  displayInstallationResults(reportData, resolveOutput(ctx.execution));

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
