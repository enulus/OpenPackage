import type { CommandResult } from '../../../../types/index.js';
import type { InstallationContext } from '../context.js';
import type { ExecutionResult } from './execute.js';
import { displayInstallationResults } from '../../install-reporting.js';
import { getInstallRootDir } from '../../../../utils/paths.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Report results phase
 */
export async function reportResultsPhase(
  ctx: InstallationContext,
  installResult: ExecutionResult
): Promise<CommandResult> {
  logger.debug(`Reporting results for ${ctx.source.packageName}`);
  
  const mainPackage = ctx.resolvedPackages.find(pkg => pkg.isRoot);
  
  // Display results (only show "dependency recorded" for dependency installs, not workspace-root)
  const isDependencyInstall = ctx.source.type !== 'workspace';
  displayInstallationResults(
    ctx.source.packageName,
    ctx.resolvedPackages,
    { platforms: ctx.platforms, created: [] },
    ctx.options,
    mainPackage,
    installResult.allAddedFiles,
    installResult.allUpdatedFiles,
    installResult.rootFileResults,
    [], // missing packages already handled
    {}, // remote outcomes already handled
    installResult.errorCount,
    installResult.errors,
    isDependencyInstall
  );
  
  // Build result data
  return {
    success: true,
    data: {
      packageName: ctx.source.packageName,
      targetDir: getInstallRootDir(ctx.cwd),
      resolvedPackages: ctx.resolvedPackages,
      totalPackages: ctx.resolvedPackages.length,
      installed: installResult.installedCount,
      skipped: installResult.skippedCount,
      totalOpenPackageFiles: installResult.installedCount + installResult.allUpdatedFiles.length
    },
    warnings: ctx.warnings.length > 0 ? Array.from(new Set(ctx.warnings)) : undefined
  };
}
