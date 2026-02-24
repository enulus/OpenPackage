import { relative, resolve } from 'path';
import type { CommandResult, InstallOptions, ExecutionContext } from '../../../types/index.js';
import type { InstallationContext } from '../unified/context.js';
import type { 
  NormalizedInstallOptions, 
  InputClassification, 
  PreprocessResult,
  InstallStrategy 
} from './types.js';
import { 
  promptBaseSelection, 
  handleAmbiguityNonInteractive,
  type BaseMatch 
} from '../ambiguity-prompts.js';
import { createInteractionPolicy, PromptTier } from '../../interaction-policy.js';
import type { InteractionPolicy } from '../../interaction-policy.js';
import type { OutputPort } from '../../ports/output.js';
import { resolveOutput, resolvePrompt } from '../../ports/resolve.js';
import {
  parseMarketplace,
  promptPluginSelection,
  promptInstallMode,
  installMarketplacePlugins,
  validatePluginNames,
  resolvePluginContentRoots,
  type MarketplaceManifest
} from '../marketplace-handler.js';
import { resolvePlatforms } from '../platform-resolution.js';
import { classifyInput } from '../preprocessing/input-classifier.js';
import { assertTargetDirOutsideMetadata, validateResolutionFlags } from '../validators/index.js';
import { runUnifiedInstallPipeline } from '../unified/pipeline.js';
import { runMultiContextPipeline } from '../unified/multi-context-pipeline.js';
import { createAllStrategies } from './strategies/index.js';
import { DependencyResolutionExecutor } from '../resolution/executor.js';
import { getManifestPathAtContentRoot } from '../resolution/manifest-reader.js';
import { handleListSelection } from '../list-handler.js';
import { discoverResources } from '../resource-discoverer.js';
import { promptResourceSelection } from '../resource-selection-menu.js';
import { buildResourceInstallContexts } from '../unified/context-builders.js';
import { logger } from '../../../utils/logger.js';
import type { ResourceInstallationSpec } from '../convenience-matchers.js';
import type { SelectedResource, ResourceDiscoveryResult, DiscoveredResource, ResourceType } from '../resource-types.js';
import { checkSubsumption, resolveSubsumption } from './subsumption-resolver.js';

/**
 * InstallOrchestrator coordinates the entire install flow.
 * 
 * Responsibilities:
 * 1. Classify input → select strategy
 * 2. Build context via strategy
 * 3. Preprocess (load, detect base, check special cases)
 * 4. Route based on PreprocessResult:
 *    - marketplace → marketplace handler
 *    - ambiguous → ambiguity handler → pipeline
 *    - multi-resource → multi-context pipeline
 *    - normal → unified pipeline
 */
export class InstallOrchestrator {
  private strategies: InstallStrategy[] = [];
  
  /**
   * Register an install strategy.
   */
  registerStrategy(strategy: InstallStrategy): void {
    this.strategies.push(strategy);
  }
  
  /**
   * Execute the install flow.
   * 
   * @param input - Package input (undefined for bulk install)
   * @param options - Normalized install options
   * @param execContext - Execution context (sourceCwd, targetDir, isGlobal)
   */
  async execute(
    input: string | undefined,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<CommandResult> {
    // Step 1: Validate
    assertTargetDirOutsideMetadata(execContext.targetDir);
    validateResolutionFlags(options);
    
    // Step 1.5: Create interaction policy (single source of truth for prompting)
    // This validates --interactive + TTY requirement and throws early if invalid
    const policy = createInteractionPolicy({
      interactive: options.interactive,
      force: options.force,
    });
    execContext.interactionPolicy = policy;
    
    // Step 2: Classify input (use sourceCwd for resolving input paths)
    const classification = await classifyInput(input, options, execContext);
    logger.info('Classified install input', { 
      type: classification.type,
      features: classification.features 
    });
    
    // Step 3: Select strategy
    const strategy = this.selectStrategy(classification);
    if (!strategy) {
      throw new Error(`No strategy found for input type: ${classification.type}`);
    }
    
    // Step 4: Build context (pass ExecutionContext)
    const context = await strategy.buildContext(classification, options, execContext);
    
    // Step 5: Preprocess (load, detect base, check special handling)
    const preprocessResult = await strategy.preprocess(context, options, execContext);
    
    // Step 6: Route based on result
    return this.routeToHandler(preprocessResult, options, execContext, policy);
  }
  
  /**
   * Select the appropriate strategy for the given classification.
   */
  private selectStrategy(classification: InputClassification): InstallStrategy | undefined {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(classification)) {
        return strategy;
      }
    }
    return undefined;
  }
  
  /**
   * Route to appropriate handler based on preprocess result.
   */
  private async routeToHandler(
    result: PreprocessResult,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext,
    policy: InteractionPolicy,
  ): Promise<CommandResult> {
    const { context, specialHandling } = result;

    // ── Commit output mode ───────────────────────────────────────────
    // Determine whether this flow requires rich (clack) output based on
    // the routing decision made during preprocessing. Once committed,
    // all ports are locked for the lifetime of the command.
    if (execContext.commitOutputMode) {
      const needsRich =
        (specialHandling === 'marketplace' && !options.plugins?.length && policy.canPrompt(PromptTier.Required)) ||
        (specialHandling === 'ambiguous' && policy.canPrompt(PromptTier.Required)) ||
        (policy.mode === 'always' && options.interactive);

      if (needsRich) {
        execContext.commitOutputMode('rich');
      }
    }

    const out = resolveOutput(execContext);

    switch (specialHandling) {
      case 'marketplace':
        return this.handleMarketplace(result, options, execContext, policy, out);
      
      case 'ambiguous':
        return this.handleAmbiguous(result, options, execContext, policy);
      
      case 'multi-resource':
        return this.handleMultiResource(result, options, execContext, policy);
      
      default: {
        // Handle --interactive option (interactive resource selection)
        if (policy.mode === 'always' && options.interactive) {
          return this.handleList(context, options, execContext);
        }
        
        // Check for subsumption (resource/package overlap)
        const subsumptionResult = await this.checkAndResolveSubsumption(context, options, out);
        if (subsumptionResult) {
          return subsumptionResult;
        }
        
        // Normal pipeline flow: resolve platforms once if not set
        if (context.platforms.length === 0) {
          // Platform resolution may prompt if no platforms are auto-detected.
          context.platforms = await resolvePlatforms(context.targetDir, options.platforms, { interactive: policy.canPrompt(PromptTier.Required), output: resolveOutput(execContext), prompt: resolvePrompt(execContext) });
        }
        // For path/git sources with manifests, install root first (updates manifest),
        // then run executor for dependencies only (with skipManifestUpdate)
        const isPathOrGit = context.source.type === 'path' || context.source.type === 'git';
        const contentRoot = context.source.contentRoot;
        const rootManifestPath =
          isPathOrGit && contentRoot ? await getManifestPathAtContentRoot(contentRoot) : null;
        if (rootManifestPath) {
          // Install root package first (this updates the workspace manifest)
          const rootResult = await runUnifiedInstallPipeline(context);
          // Then install dependencies via executor (skipManifestUpdate for deps)
          return this.installDependenciesOnly(rootManifestPath, rootResult, context, options, execContext);
        }
        return runUnifiedInstallPipeline(context);
      }
    }
  }

  /**
   * Check for subsumption (resource/package overlap) and resolve if needed.
   * 
   * Returns a CommandResult if the install should be skipped (already-covered),
   * or null to proceed with normal installation.
   * 
   * For upgrade scenarios (resource -> full package), cleans up the old entries
   * and returns null so the full install proceeds.
   */
  private async checkAndResolveSubsumption(
    context: InstallationContext,
    options: NormalizedInstallOptions,
    out: OutputPort
  ): Promise<CommandResult | null> {
    // --force bypasses subsumption checks entirely
    if (options.force) {
      return null;
    }

    try {
      const result = await checkSubsumption(context.source, context.targetDir);

      switch (result.type) {
        case 'upgrade': {
          // Resource entries exist that will be subsumed by the full package.
          // Silently resolve; the report phase will show replaced resources.
          const replacedNames = result.entriesToRemove.map(e => e.packageName);
          await resolveSubsumption(result, context.execution);
          context._replacedResources = replacedNames;
          return null; // Proceed with install
        }

        case 'already-covered': {
          // Full package already installed; skip resource install
          const resourcePath = context.source.resourcePath || 
            context.source.packageName.replace(/^.*?\/[^/]+\/[^/]+\//, '');
          out.info(`Skipped: ${resourcePath} is already installed via ${result.coveringPackage}`);
          return {
            success: true,
            data: {
              packageName: context.source.packageName,
              installed: 0,
              skipped: 1,
              reason: `Already installed via ${result.coveringPackage}`
            }
          };
        }

        case 'none':
        default:
          return null;
      }
    } catch (error) {
      // Subsumption check is non-fatal; log and proceed with normal install
      logger.warn(`Subsumption check failed (proceeding with install): ${error}`);
      return null;
    }
  }

  /**
   * Install dependencies only (after root package is already installed).
   * The root package is installed separately via unified pipeline to ensure manifest is updated.
   */
  private async installDependenciesOnly(
    rootManifestPath: string,
    rootResult: CommandResult,
    context: InstallationContext,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<CommandResult> {
    const policy = execContext.interactionPolicy;
    const platforms =
      context.platforms.length > 0
        ? context.platforms
        : await resolvePlatforms(context.targetDir, options.platforms, { interactive: policy?.canPrompt(PromptTier.Required) ?? false, output: resolveOutput(execContext), prompt: resolvePrompt(execContext) });

    const skipCache = options.resolutionMode === 'remote-primary';
    
    const executor = new DependencyResolutionExecutor(execContext, {
      graphOptions: {
        workspaceRoot: execContext.targetDir,
        rootManifestPath,
        includeRoot: false, // Root already installed, just deps
        includeDev: true,
        maxDepth: 10,
        skipCache
      },
      loaderOptions: {
        parallel: true,
        cacheEnabled: !skipCache,
        installOptions: { ...options, skipManifestUpdate: true }
      },
      plannerOptions: {
        platforms,
        installOptions: { ...options, skipManifestUpdate: true },
        force: options.force ?? false
      },
      dryRun: options.dryRun ?? false,
      failFast: false
    });

    const execResult = await executor.execute();
    
    // Combine root result with dependency results
    const rootInstalled = (rootResult.data as { installed?: number })?.installed ?? 0;
    const depInstalled = execResult.summary?.installed ?? 0;
    const depSkipped = (execResult.summary?.skipped ?? 0) + (execResult.summary?.failed ?? 0);

    return {
      success: rootResult.success && execResult.success,
      data: {
        packageName: context.source.packageName,
        installed: rootInstalled + depInstalled,
        skipped: depSkipped,
        results: execResult.results
      },
      error: execResult.error ?? rootResult.error,
      warnings: execResult.warnings ?? rootResult.warnings
    };
  }
  
  /**
   * Handle marketplace installation.
   * Delegates to marketplace-handler.ts
   */
  private async handleMarketplace(
   result: PreprocessResult,
   options: NormalizedInstallOptions,
   execContext: ExecutionContext,
   policy: InteractionPolicy,
   out: OutputPort
  ): Promise<CommandResult> {
   const { context } = result;
   
   if (!context.source.pluginMetadata?.manifestPath) {
     throw new Error('Marketplace manifest not found');
   }
   
    const spinner = out.spinner();
    spinner.start('Loading marketplace');
   
   const marketplace = await parseMarketplace(
     context.source.pluginMetadata.manifestPath, 
     { repoPath: context.source.contentRoot }
   );
   
    spinner.stop(`Marketplace: ${marketplace.name}`);
   
   // Marketplace already has interactive plugin selection (promptPluginSelection, promptInstallMode).
   // Per InstallOptions.interactive: "Ignored for marketplace sources (which already have plugin selection)."
   // Using -i here would trigger handleMarketplaceList which loads ALL plugins upfront (e.g. 56 git clones)
   // before any prompt—causing a long hang. Use the normal flow: pick plugin first, then load only that one.

   let selectedPlugin: string;
   let installMode: 'full' | 'partial' = 'full';
   
   if (options.plugins && options.plugins.length > 0) {
     // Non-interactive: validate provided plugin names and install all as full
     const { valid, invalid } = validatePluginNames(marketplace, options.plugins);
     
     if (invalid.length > 0) {
       const errorMsg = [
         `Error: The following plugins were not found in marketplace '${marketplace.name}':`,
         ...invalid.map(name => `  - ${name}`),
         `\nAvailable plugins: ${marketplace.plugins.map(p => p.name).join(', ')}`
       ].join('\n');
        out.error(errorMsg);
        return {
          success: false,
          error: `Plugins not found: ${invalid.join(', ')}`
        };
      }
      
      if (valid.length === 0) {
        out.info('No valid plugins specified. Installation cancelled.');
        return { success: true, data: { installed: 0, skipped: 0 } };
      }
      
      out.message(`Installing ${valid.length} plugin${valid.length === 1 ? '' : 's'}: ${valid.join(', ')}`);
      
      // Install each plugin in full mode (non-interactive)
      const results: CommandResult[] = [];
      for (const pluginName of valid) {
        const commitSha = (context.source as any)._commitSha || '';
        if (!commitSha) {
          throw new Error('Marketplace commit SHA not available');
        }
        
        const result = await installMarketplacePlugins(
          context.source.contentRoot!,
          marketplace,
          pluginName,
          'full',
          context.source.gitUrl!,
          context.source.gitRef,
          commitSha,
          options,
          execContext,
          { agents: options.agents, skills: options.skills, rules: options.rules, commands: options.commands }
        );
        
        results.push(result);
      }
      
      // Return combined result
      const allSuccess = results.every(r => r.success);
      const anySuccess = results.some(r => r.success);
      
      return {
        success: anySuccess,
        error: allSuccess ? undefined : 'Some plugins failed to install'
      };
    } else if (policy.canPrompt(PromptTier.Required)) {
      // Interactive: prompt user for single plugin selection
      selectedPlugin = await promptPluginSelection(marketplace, execContext);
      
       if (!selectedPlugin) {
         // Cancel already shown by clack.cancel() in prompt adapter; skip redundant warn to avoid orphan "│"
         return { success: true, data: { installed: 0, skipped: 0 } };
       }
       
       // Prompt for install mode
       const mode = await promptInstallMode(selectedPlugin, execContext);
       
       if (!mode) {
         // Cancel already shown by clack.cancel() in prompt adapter; skip redundant warn
         return { success: true, data: { installed: 0, skipped: 0 } };
       }
     
     installMode = mode;
   } else {
     // Non-interactive without --plugins: error with actionable message
     const pluginNames = marketplace.plugins.map(p => p.name).join(', ');
     throw new Error(
       `Marketplace '${marketplace.name}' requires plugin selection.\n` +
       `Use --plugins to specify plugins in non-interactive mode.\n` +
       `Available plugins: ${pluginNames}`
     );
   }
   
   // Verify it's a git source
   if (context.source.type !== 'git' || !context.source.gitUrl) {
     throw new Error('Marketplace must be from a git source');
   }
   
   const commitSha = (context.source as any)._commitSha || '';
   if (!commitSha) {
     throw new Error('Marketplace commit SHA not available');
   }
   
   return await installMarketplacePlugins(
     context.source.contentRoot!,
     marketplace,
     selectedPlugin,
     installMode,
     context.source.gitUrl,
     context.source.gitRef,
     commitSha,
     options,
     execContext,
     {
       agents: options.agents,
       skills: options.skills,
       rules: options.rules,
       commands: options.commands
     }
   );
  }
  
  /**
  * Handle --interactive for marketplace: discover resources across specified plugins
  * and present a combined interactive selection menu.
  * 
  * If --plugins is specified, only those plugins are included.
  * Otherwise, all marketplace plugins are included.
  */
   private async handleMarketplaceList(
    context: InstallationContext,
    marketplace: MarketplaceManifest,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
   ): Promise<CommandResult> {
    const out = resolveOutput(execContext);
    // Determine which plugins to list
    let pluginNames: string[];
    
    if (options.plugins && options.plugins.length > 0) {
      const { valid, invalid } = validatePluginNames(marketplace, options.plugins);
      
      if (invalid.length > 0) {
        const errorMsg = [
          `Error: The following plugins were not found in marketplace '${marketplace.name}':`,
          ...invalid.map(name => `  - ${name}`),
          `\nAvailable plugins: ${marketplace.plugins.map(p => p.name).join(', ')}`
        ].join('\n');
        out.error(errorMsg);
        return {
          success: false,
          error: `Plugins not found: ${invalid.join(', ')}`
        };
      }
      
      pluginNames = valid;
    } else {
      // No --plugins: list all marketplace plugins
      pluginNames = marketplace.plugins.map(p => p.name);
    }
    
    if (pluginNames.length === 0) {
      out.info('No plugins to list.');
      return { success: true, data: { installed: 0, skipped: 0 } };
    }
    
    out.info(`Marketplace: ${marketplace.name}`);
    
    const commitSha = (context.source as any)._commitSha || '';
    if (!commitSha) {
      throw new Error('Marketplace commit SHA not available');
    }
    
    // Resolve content roots for all plugins
    const s = out.spinner();
    s.start(`Discovering resources across ${pluginNames.length} plugin${pluginNames.length === 1 ? '' : 's'}`);
    
    const resolvedPlugins = await resolvePluginContentRoots(
      context.source.contentRoot!,
      marketplace,
      pluginNames,
      context.source.gitUrl!,
      context.source.gitRef,
      commitSha,
      options,
      execContext
    );
    
    if (resolvedPlugins.length === 0) {
      s.stop('No plugins resolved');
      out.warn('Could not resolve any plugins for resource discovery');
      return { success: true, data: { installed: 0, skipped: 0 } };
    }
   
   // Discover resources in each plugin and merge
   const allResources: DiscoveredResource[] = [];
   
   for (const plugin of resolvedPlugins) {
     const discovery = await discoverResources(plugin.basePath, plugin.repoRoot);
     
     // Prefix display names with plugin name when multiple plugins
     if (resolvedPlugins.length > 1) {
       for (const resource of discovery.all) {
         resource.displayName = `${plugin.pluginEntry.name}/${resource.displayName}`;
       }
     }
     
     allResources.push(...discovery.all);
   }
   
   // Build merged discovery result
   const byType = new Map<ResourceType, DiscoveredResource[]>();
   for (const resource of allResources) {
     const existing = byType.get(resource.resourceType) || [];
     existing.push(resource);
     byType.set(resource.resourceType, existing);
   }
   
   const mergedDiscovery: ResourceDiscoveryResult = {
     all: allResources,
     byType,
     total: allResources.length,
     basePath: resolvedPlugins[0].basePath,
     repoRoot: resolvedPlugins[0].repoRoot
   };
   
   if (mergedDiscovery.total === 0) {
     s.stop('No resources found');
      out.warn('No installable resources found across the specified plugins');
     return { success: true, data: { installed: 0, skipped: 0 } };
   }
   
   s.stop(`Found ${mergedDiscovery.total} resource${mergedDiscovery.total === 1 ? '' : 's'}`);
   
   // Interactive selection
    const selected = await promptResourceSelection(
      mergedDiscovery,
      marketplace.name,
      undefined,
      resolveOutput(execContext),
      resolvePrompt(execContext)
    );

   if (selected.length === 0) {
      return { success: true, data: { installed: 0, skipped: 0 } };
   }
   
   // Build resource contexts per plugin and install
   // Group selected resources by which plugin they came from (by filePath prefix)
   const allResourceContexts: InstallationContext[] = [];
   
   for (const plugin of resolvedPlugins) {
     const pluginSelected = selected.filter(s => 
       s.filePath.startsWith(plugin.basePath)
     );
     
     if (pluginSelected.length === 0) continue;
     
     const resourceSpecs: ResourceInstallationSpec[] = pluginSelected.map(s => ({
       name: resolvedPlugins.length > 1 
         ? s.displayName.replace(`${plugin.pluginEntry.name}/`, '')
         : s.displayName,
       resourceType: s.resourceType as 'agent' | 'skill' | 'command' | 'rule',
       resourcePath: s.resourcePath,
       basePath: resolve(plugin.basePath),
       resourceKind: s.installKind,
       matchedBy: 'filename' as const,
       resourceVersion: s.version
     }));
     
     const resourceContexts = buildResourceInstallContexts(
       plugin.context,
       resourceSpecs,
       plugin.repoRoot
     ).map(rc => {
       if (rc.source.type === 'path') {
         rc.source.localPath = plugin.repoRoot;
       }
       return rc;
     });
     
     allResourceContexts.push(...resourceContexts);
   }
   
   if (allResourceContexts.length === 0) {
     return { success: true, data: { installed: 0, skipped: 0 } };
   }
   
   const pipelineResult = await runMultiContextPipeline(allResourceContexts, {
     groupReport: true,
     groupReportPackageName: marketplace.name
   });
   
   return {
     success: pipelineResult.success,
     error: pipelineResult.error,
     data: {
       installed: pipelineResult.data?.installed || 0,
       skipped: pipelineResult.data?.skipped || 0
     }
   };
  }
  
  /**
   * Handle ambiguous base resolution.
   * Prompts user or auto-selects, then continues to pipeline.
   */
  private async handleAmbiguous(
    result: PreprocessResult,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext,
    policy: InteractionPolicy
  ): Promise<CommandResult> {
    const { context, ambiguousMatches } = result;
    
    if (!ambiguousMatches || ambiguousMatches.length === 0) {
      if (context.platforms.length === 0) {
        context.platforms = await resolvePlatforms(context.targetDir, options.platforms, { interactive: policy.canPrompt(PromptTier.Required), output: resolveOutput(execContext), prompt: resolvePrompt(execContext) });
      }
      return runUnifiedInstallPipeline(context);
    }
    
    const repoRoot = context.source.contentRoot || context.targetDir;
    
    // Format matches for prompts
    const matches: BaseMatch[] = ambiguousMatches.map(m => ({
      base: m.base,
      pattern: m.pattern,
      startIndex: m.startIndex,
      exampleTarget: `${m.pattern} → <platforms>/${m.pattern.replace('**/', '').replace('*', 'file')}`
    }));
    
    let selectedMatch: BaseMatch;
    
    if (options.force || !policy.canPrompt(PromptTier.Disambiguation)) {
      selectedMatch = handleAmbiguityNonInteractive(matches, resolveOutput(execContext));
    } else {
      const resourcePath = context.source.resourcePath || context.source.gitPath || '';
      selectedMatch = await promptBaseSelection(resourcePath, matches, repoRoot, resolveOutput(execContext), resolvePrompt(execContext));
    }
    
    // Update context with selection
    context.detectedBase = selectedMatch.base;
    context.matchedPattern = selectedMatch.pattern;
    context.baseSource = 'user-selection';
    context.baseRelative = relative(repoRoot, selectedMatch.base) || '.';
    
    logger.info('Ambiguous base resolved', {
      base: context.detectedBase,
      pattern: context.matchedPattern
    });

    if (context.platforms.length === 0) {
      context.platforms = await resolvePlatforms(context.targetDir, options.platforms, { interactive: policy.canPrompt(PromptTier.Required), output: resolveOutput(execContext), prompt: resolvePrompt(execContext) });
    }
    return runUnifiedInstallPipeline(context);
  }
  
  /**
   * Handle interactive resource selection (--interactive option).
   * Discovers all resources, prompts for selection, and installs selected items.
   */
  private async handleList(
    context: InstallationContext,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<CommandResult> {
    return handleListSelection(context, options, execContext);
  }
  
  /**
   * Handle multi-resource installation (bulk install or convenience filters).
   * For bulk install (opkg i), uses DependencyResolutionExecutor for recursive dependency resolution.
   */
  private async handleMultiResource(
    result: PreprocessResult,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext,
    policy: InteractionPolicy
  ): Promise<CommandResult> {
    const out = resolveOutput(execContext);
    const { context, resourceContexts, workspaceContext } = result;
    const dependencyContexts = resourceContexts ?? [];

    const needsPlatforms =
      dependencyContexts.some((ctx) => ctx.platforms.length === 0) ||
      (workspaceContext?.platforms.length === 0);

    if (needsPlatforms) {
      const resolvedPlatforms = await resolvePlatforms(context.targetDir, options.platforms, { interactive: policy.canPrompt(PromptTier.Required), output: resolveOutput(execContext), prompt: resolvePrompt(execContext) });
      for (const ctx of dependencyContexts) {
        if (ctx.platforms.length === 0) ctx.platforms = resolvedPlatforms;
      }
      if (workspaceContext && workspaceContext.platforms.length === 0) {
        workspaceContext.platforms = resolvedPlatforms;
      }
    }

    if (dependencyContexts.length === 0 && !workspaceContext) {
      if (context.source.packageName === '__bulk__') {
        out.warn('No packages found in openpackage.yml');
        out.info('\nTips:');
        out.info('  - Add packages to the "dependencies" array in openpackage.yml');
        out.info('  - Add development packages to the "dev-dependencies" array');
        out.info('  - Use "opkg install <package-name>" to install a specific package');
        return { success: true, data: { installed: 0, skipped: 0 } };
      }
      return {
        success: false,
        error: 'No resources matched the specified filters'
      };
    }

    if (context.source.packageName === '__bulk__') {
      return this.runRecursiveBulkInstall(options, execContext, workspaceContext ?? undefined);
    }

    // For non-bulk multi-resource installs (convenience filters), check subsumption
    // per resource context and filter out already-covered ones
    if (!options.force && dependencyContexts.length > 0) {
      const filteredContexts: InstallationContext[] = [];
      let skippedCount = 0;

      for (const ctx of dependencyContexts) {
        const subsumptionResult = await checkSubsumption(ctx.source, ctx.targetDir);
        if (subsumptionResult.type === 'already-covered') {
          const resourcePath = ctx.source.resourcePath ||
            ctx.source.packageName.replace(/^.*?\/[^/]+\/[^/]+\//, '');
          out.info(`Skipped: ${resourcePath} is already installed via ${subsumptionResult.coveringPackage}`);
          skippedCount++;
        } else {
          filteredContexts.push(ctx);
        }
      }

      if (filteredContexts.length === 0) {
        return {
          success: true,
          data: {
            packageName: context.source.packageName,
            installed: 0,
            skipped: skippedCount,
            reason: 'All resources already installed via full package'
          }
        };
      }

      // Replace with filtered list
      if (skippedCount > 0) {
        dependencyContexts.length = 0;
        dependencyContexts.push(...filteredContexts);
      }
    }

    if (dependencyContexts.length > 0) {
      out.success(`Installing ${dependencyContexts.length} package${dependencyContexts.length === 1 ? '' : 's'} from openpackage.yml`);
    }

    if (workspaceContext) {
      try {
        await runUnifiedInstallPipeline(workspaceContext);
      } catch (error) {
        logger.warn('Workspace root install failed', { error });
      }
    }

    if (dependencyContexts.length === 0) {
      return { success: true, data: { installed: 0, skipped: 0 } };
    }

    return this.runBulkInstall(dependencyContexts, context.source.packageName);
  }

  /**
   * Run bulk install using recursive dependency resolution (graph + pipeline per package).
   */
  private async runRecursiveBulkInstall(
    options: NormalizedInstallOptions,
    execContext: ExecutionContext,
    workspaceContext?: InstallationContext | null
  ): Promise<CommandResult> {
    const out = resolveOutput(execContext);
    if (workspaceContext) {
      try {
        await runUnifiedInstallPipeline(workspaceContext);
      } catch (error) {
        logger.warn('Workspace root install failed', { error });
      }
    }

    // Reuse platforms from workspace context when available (avoid duplicate prompt)
    const policy = execContext.interactionPolicy;
    let platforms = workspaceContext?.platforms?.length
      ? workspaceContext.platforms
      : await resolvePlatforms(execContext.targetDir, options.platforms, { interactive: policy?.canPrompt(PromptTier.Required) ?? false, output: resolveOutput(execContext), prompt: resolvePrompt(execContext) });

    const skipCache = options.resolutionMode === 'remote-primary';
    
    const executor = new DependencyResolutionExecutor(execContext, {
      graphOptions: {
        workspaceRoot: execContext.targetDir,
        includeDev: true,
        maxDepth: 10,
        skipCache
      },
      loaderOptions: {
        parallel: true,
        cacheEnabled: !skipCache,
        // Recursive dependency installs should not modify workspace openpackage.yml
        installOptions: { ...options, skipManifestUpdate: true }
      },
      plannerOptions: {
        platforms,
        // Recursive dependency installs should not modify workspace openpackage.yml
        installOptions: { ...options, skipManifestUpdate: true },
        force: options.force ?? false
      },
      dryRun: options.dryRun ?? false,
      failFast: false
    });

    const execResult = await executor.execute();

    const summary = execResult.summary;
    if (summary) {
      out.success(`Installation complete: ${summary.installed} installed${summary.failed > 0 ? `, ${summary.failed} failed` : ''}${summary.skipped > 0 ? `, ${summary.skipped} skipped` : ''}`);
    }

    return {
      success: execResult.success,
      data: summary
        ? { installed: summary.installed, skipped: summary.failed + summary.skipped, results: execResult.results }
        : { installed: 0, skipped: 0 },
      error: execResult.error,
      warnings: execResult.warnings
    };
  }
  
  /**
   * Run bulk installation for multiple resources from the same package.
   * Used for convenience filters (--agents, --skills, etc.) matching multiple resources.
   * Groups output into a single report for parity with interactive multiselect.
   */
  private async runBulkInstall(
    contexts: InstallationContext[],
    basePackageName: string
  ): Promise<CommandResult> {
    const result = await runMultiContextPipeline(contexts, {
      groupReport: true,
      groupReportPackageName: basePackageName
    });

    const results = (result.data as any)?.results ?? [];
    const failedCount = results.filter((r: { success: boolean }) => !r.success).length;
    const totalInstalled = (result.data as any)?.installed ?? 0;

    if (failedCount > 0 || totalInstalled > 0) {
      const out = resolveOutput(contexts[0]?.execution);
      out.success(`Installation complete: ${totalInstalled} installed${failedCount > 0 ? `, ${failedCount} failed` : ''}`);
    }

    return {
      ...result,
      error: result.success ? undefined : `${failedCount} resource${failedCount === 1 ? '' : 's'} failed to install`
    };
  }
}

/**
 * Create a configured orchestrator with all strategies registered.
 */
export function createOrchestrator(): InstallOrchestrator {
  const orchestrator = new InstallOrchestrator();
  
  // Register all strategies
  for (const strategy of createAllStrategies()) {
    orchestrator.registerStrategy(strategy);
  }
  
  return orchestrator;
}
