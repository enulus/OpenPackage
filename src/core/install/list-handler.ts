/**
 * List Handler Module
 * 
 * Handles --list option integration with install orchestrator
 */

import { resolve } from 'path';
import { logger } from '../../utils/logger.js';
import { canPrompt } from './ambiguity-prompts.js';
import { discoverResources } from './resource-discoverer.js';
import { promptResourceSelection, displaySelectionSummary } from './resource-selection-menu.js';
import { buildResourceInstallContexts } from './unified/context-builders.js';
import { runMultiContextPipeline } from './unified/multi-context-pipeline.js';
import { getLoaderForSource } from './sources/loader-factory.js';
import { applyBaseDetection } from './preprocessing/base-resolver.js';
import type { InstallationContext } from './unified/context.js';
import type { NormalizedInstallOptions } from './orchestrator/types.js';
import type { ExecutionContext, CommandResult } from '../../types/index.js';
import type { ResourceInstallationSpec } from './convenience-matchers.js';
import type { SelectedResource } from './resource-types.js';

/**
 * Handle interactive resource selection (--list option)
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
  
  // Load source to get content root and base detection
  const loader = getLoaderForSource(context.source);
  const loaded = await loader.load(context.source, options, execContext);
  
  // Update context with loaded data
  context.source.packageName = loaded.packageName;
  context.source.version = loaded.version;
  context.source.contentRoot = loaded.contentRoot;
  context.source.pluginMetadata = loaded.pluginMetadata;
  
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
  
  // Discover all resources
  const discovery = await discoverResources(basePath, repoRoot);
  
  // Check if any resources found
  if (discovery.total === 0) {
    console.log('⚠️  No installable resources found in this package');
    return {
      success: true,
      data: { installed: 0, skipped: 0 }
    };
  }
  
  // Interactive or non-interactive selection
  let selected: SelectedResource[];
  
  if (canPrompt()) {
    // Interactive mode: show menu
    selected = await promptResourceSelection(
      discovery,
      context.source.packageName,
      context.source.version
    );
    
    if (selected.length === 0) {
      console.log('No resources selected. Installation cancelled.');
      return {
        success: true,
        data: { installed: 0, skipped: 0 }
      };
    }
    
    // Display selection summary
    displaySelectionSummary(selected);
  } else {
    // Non-interactive mode: install all resources
    console.log('⚠️  Non-interactive mode: installing all discovered resources');
    selected = discovery.all.map(r => ({
      resourceType: r.resourceType,
      resourcePath: r.resourcePath,
      displayName: r.displayName,
      filePath: r.filePath,
      installKind: r.installKind,
      version: r.version
    }));
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
  
  // Run multi-context pipeline
  const result = await runMultiContextPipeline(resourceContexts);
  
  return {
    success: result.success,
    error: result.error,
    data: {
      installed: result.data?.installed || 0,
      skipped: result.data?.skipped || 0
    }
  };
}
