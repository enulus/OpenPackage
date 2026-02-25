import type { InstallationContext } from '../context.js';
import { performIndexBasedInstallationPhases } from '../../operations/installation-executor.js';
import { resolvePlatforms } from '../../platform-resolution.js';
import { logger } from '../../../../utils/logger.js';
import { splitPackageNameForTelemetry } from '../../../../utils/plugin-naming.js';
import { resolveOutput, resolvePrompt } from '../../../ports/resolve.js';
import { PromptTier } from '../../../interaction-policy.js';

import type { RelocatedFile } from '../../conflicts/file-conflict-resolver.js';

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
  /** True when namespace conflict resolution was triggered for any package */
  namespaced?: boolean;
  /** Files that were physically relocated on disk during namespace resolution */
  relocatedFiles?: RelocatedFile[];
}

/**
 * Execute installation phase
 */
export async function executeInstallationPhase(
  ctx: InstallationContext
): Promise<ExecutionResult> {
  // Resolve platforms if not already set (orchestrator preflight sets for bulk/single)
  if (ctx.platforms.length === 0) {
    const canPrompt = ctx.execution.interactionPolicy?.canPrompt(PromptTier.Required) ?? false;
    ctx.platforms = await resolvePlatforms(
      ctx.targetDir,
      ctx.options.platforms,
      { interactive: canPrompt, output: resolveOutput(ctx.execution), prompt: resolvePrompt(ctx.execution) }
    );
  }

  // Get conflict result from context
  const conflictResult = ctx.conflictResult;

  // Execute installation
  const outcome = await performIndexBasedInstallationPhases({
    cwd: ctx.targetDir,
    packages: ctx.resolvedPackages,
    platforms: ctx.platforms,
    conflictResult,
    options: ctx.options,
    targetDir: ctx.targetDir,
    matchedPattern: ctx.matchedPattern,  // Phase 4: Pass matched pattern
    prompt: ctx.execution?.prompt,
    indexWriteCollector: ctx.execution?.indexWriteCollector,
    sharedOwnershipContext: ctx.execution?.sharedOwnershipContext
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
      // Split package name into base name and resource path
      // This handles cases like "gh@user/repo/agents/designer" -> base: "gh@user/repo", path: "agents/designer"
      const { baseName, resourcePath: nameResourcePath } = splitPackageNameForTelemetry(pkg.name);
      
      // Determine the actual resource path to send
      // Priority: ctx.matchedPattern > nameResourcePath (extracted from package name)
      const resourcePath = ctx.matchedPattern || nameResourcePath;
      
      // Determine resource type
      let resourceType: string | undefined;
      if (pkg.marketplaceMetadata) {
        resourceType = 'plugin';
      } else if (resourcePath) {
        // Check if this was an agent or skill based on resource path
        if (resourcePath.includes('agent')) {
          resourceType = 'agent';
        } else if (resourcePath.includes('skill')) {
          resourceType = 'skill';
        }
      }
      
      // Extract resource name from resource path or package name
      const resourceName = resourcePath 
        ? resourcePath.split('/').pop()?.replace(/\.(md|json)$/, '') || pkg.name.split('/').pop() || pkg.name
        : pkg.name.split('/').pop() || pkg.name;
      
      ctx.execution.telemetryCollector.recordInstall({
        packageName: baseName,  // Send base package name (e.g., "gh@user/repo")
        version: pkg.version,
        resourcePath,           // Send resource path separately (e.g., "agents/designer")
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

