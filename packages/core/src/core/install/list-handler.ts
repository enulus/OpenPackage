/**
 * List Handler Module
 * 
 * Handles --interactive option integration with install orchestrator
 */

import { resolve } from 'path';
import { logger } from '../../utils/logger.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { PromptTier } from '../../core/interaction-policy.js';
import { discoverResources } from './resource-discoverer.js';
import { promptResourceSelection } from './resource-selection-menu.js';
import { buildResourceInstallContexts } from './unified/context-builders.js';
import { runMultiContextPipeline } from './unified/multi-context-pipeline.js';
import { getLoaderForSource } from './sources/loader-factory.js';
import { applyBaseDetection } from './preprocessing/base-resolver.js';
import { createResolvedPackageFromLoaded } from './preprocessing/context-population.js';
import type { InstallationContext } from './unified/context.js';
import type { NormalizedInstallOptions } from './orchestrator/types.js';
import type { ExecutionContext, CommandResult } from '../../types/index.js';
import type { ResourceInstallationSpec } from './convenience-matchers.js';
import type { SelectedResource } from './resource-types.js';

/**
 * Handle interactive resource selection (--interactive option)
 * 
 * @param context - Installation context
 * @param options - Normalized install options
 * @param execContext - Execution context
 * @returns Command result
 */
export async function handleListSelection(
  context: InstallationContext,
  options: NormalizedInstallOptions,
  execContext: ExecutionContext
): Promise<CommandResult> {
  logger.info('Handling interactive resource selection', {
    packageName: context.source.packageName
  });
  
  const out = resolveOutput(execContext);
  
  // Load source to get content root and base detection
  const loader = getLoaderForSource(context.source);
  const loaded = await loader.load(context.source, options, execContext);
  
  // Update context with loaded data
  context.source.packageName = loaded.packageName;
  context.source.version = loaded.version;
  context.source.contentRoot = loaded.contentRoot;
  context.source.pluginMetadata = loaded.pluginMetadata;
  
  // Populate root resolved package so per-resource contexts skip re-loading in the pipeline.
  context.resolvedPackages = [createResolvedPackageFromLoaded(loaded, context)];
  
  // Apply base detection
  if (loaded.sourceMetadata?.baseDetection) {
    applyBaseDetection(context, loaded);
  }
  
  // Determine base path and repo root
  const basePath = context.detectedBase || loaded.contentRoot || execContext.targetDir;
  const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot || basePath;
  
  logger.debug('Resource discovery paths', {
    basePath,
    repoRoot,
    detectedBase: context.detectedBase
  });
  
  // Discover all resources with spinner
  const s = out.spinner();
  s.start('Discovering resources');
  
  const discovery = await discoverResources(basePath, repoRoot);
  
  if (discovery.total === 0) {
    s.stop('No resources found');
  } else {
    s.stop(`Found ${discovery.total} resource${discovery.total === 1 ? '' : 's'}`);
  }
  
  // Check if any resources found
  if (discovery.total === 0) {
    out.warn('No installable resources found in this package');
    return {
      success: true,
      data: { installed: 0, skipped: 0 }
    };
  }
  
  // Interactive or non-interactive selection
  let selected: SelectedResource[];
  
  const policy = execContext.interactionPolicy;
  if (!policy?.canPrompt(PromptTier.OptionalMenu)) {
    throw new Error('Interactive resource selection requires a TTY. Use --agents, --skills, --rules, or --commands to specify resources directly.');
  }

  selected = await promptResourceSelection(
    discovery,
    context.source.packageName,
    context.source.version,
    resolveOutput(execContext),
    resolvePrompt(execContext)
  );
  
  if (selected.length === 0) {
    return {
      success: true,
      data: { installed: 0, skipped: 0 }
    };
  }
  
  // Convert selected resources to ResourceInstallationSpec format
  const resourceSpecs: ResourceInstallationSpec[] = selected.map(s => ({
    name: s.displayName,
    resourceType: s.resourceType as 'agent' | 'skill' | 'command' | 'rule',
    resourcePath: s.resourcePath,
    basePath: resolve(basePath),
    resourceKind: s.installKind,
    matchedBy: 'filename' as const,
    resourceVersion: s.version
  }));
  
  // Build resource contexts for installation
  const resourceContexts = buildResourceInstallContexts(
    context,
    resourceSpecs,
    repoRoot
  ).map(rc => {
    // Ensure path-based loader can resolve repo-relative resourcePath
    if (rc.source.type === 'path') {
      rc.source.localPath = repoRoot;
    }
    return rc;
  });
  
  // Run multi-context pipeline with grouped report for multi-resource selection
  const result = await runMultiContextPipeline(resourceContexts, {
    groupReport: true,
    groupReportPackageName: context.source.packageName
  });
  
  return {
    success: result.success,
    error: result.error,
    data: {
      installed: result.data?.installed || 0,
      skipped: result.data?.skipped || 0
    }
  };
}
