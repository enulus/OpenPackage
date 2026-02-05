import type { InstallationContext } from '../context.js';
import { performIndexBasedInstallationPhases } from '../../operations/installation-executor.js';
import { displayDependencyTree } from '../../../dependency-resolver/display.js';
import { resolvePlatforms } from '../../platform-resolution.js';
import { logger } from '../../../../utils/logger.js';

export interface ExecutionResult {
  installedCount: number;
  skippedCount: number;
  errorCount: number;
  allAddedFiles: string[];
  allUpdatedFiles: string[];
  rootFileResults: { installed: string[]; updated: string[]; skipped: string[] };
  hadErrors: boolean;
  installedAnyFiles: boolean;
  errors?: string[];
}

/**
 * Execute installation phase
 */
export async function executeInstallationPhase(
  ctx: InstallationContext
): Promise<ExecutionResult> {
  logger.debug(`Executing installation for ${ctx.resolvedPackages.length} packages`);
  
  // Display dependency tree
  displayDependencyTree(ctx.resolvedPackages, true);
  
  // Resolve platforms if not already set (orchestrator preflight sets for bulk/single)
  if (ctx.platforms.length === 0) {
    const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    ctx.platforms = await resolvePlatforms(
      ctx.targetDir,
      ctx.options.platforms,
      { interactive: canPrompt }
    );
  } else {
    logger.debug('Platforms already resolved', { platforms: ctx.platforms });
  }
  
  // Get conflict result from context
  const conflictResult = (ctx as any).conflictResult;
  
  // Execute installation
  const outcome = await performIndexBasedInstallationPhases({
    cwd: ctx.targetDir,
    packages: ctx.resolvedPackages,
    platforms: ctx.platforms,
    conflictResult,
    options: ctx.options,
    targetDir: ctx.targetDir,
    matchedPattern: ctx.matchedPattern  // Phase 4: Pass matched pattern
  });
  
  // Track errors in context
  outcome.errors?.forEach(e => ctx.errors.push(e));
  
  const hadErrors = outcome.errorCount > 0;
  const installedAnyFiles =
    outcome.allAddedFiles.length > 0 ||
    outcome.allUpdatedFiles.length > 0 ||
    outcome.rootFileResults.installed.length > 0 ||
    outcome.rootFileResults.updated.length > 0;
  
  // Record telemetry for successful installations
  if (installedAnyFiles && ctx.execution.telemetryCollector) {
    for (const pkg of ctx.resolvedPackages) {
      // Determine resource type
      let resourceType: string | undefined;
      if (pkg.marketplaceMetadata) {
        resourceType = 'plugin';
      } else if (ctx.matchedPattern) {
        // Check if this was an agent or skill based on pattern
        if (ctx.matchedPattern.includes('agent')) {
          resourceType = 'agent';
        } else if (ctx.matchedPattern.includes('skill')) {
          resourceType = 'skill';
        }
      }
      
      // Extract resource name from package name
      const resourceName = pkg.name.split('/').pop() || pkg.name;
      
      ctx.execution.telemetryCollector.recordInstall({
        packageName: pkg.name,
        version: pkg.version,
        resourcePath: ctx.matchedPattern,
        resourceType,
        resourceName,
        marketplaceName: pkg.marketplaceMetadata?.pluginName,
        pluginName: pkg.marketplaceMetadata?.pluginName
      });
    }
  }
  
  return {
    ...outcome,
    hadErrors,
    installedAnyFiles,
    errors: outcome.errors
  };
}

