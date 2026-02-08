import { relative } from 'path';
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
  canPrompt, 
  handleAmbiguityNonInteractive,
  type BaseMatch 
} from '../ambiguity-prompts.js';
import {
  parseMarketplace,
  promptPluginSelection,
  installMarketplacePlugins,
  validatePluginNames
} from '../marketplace-handler.js';
import { resolvePlatforms } from '../platform-resolution.js';
import { Spinner } from '../../../utils/spinner.js';
import { classifyInput } from '../preprocessing/input-classifier.js';
import { assertTargetDirOutsideMetadata, validateResolutionFlags } from '../validators/index.js';
import { runUnifiedInstallPipeline } from '../unified/pipeline.js';
import { runMultiContextPipeline } from '../unified/multi-context-pipeline.js';
import { createAllStrategies } from './strategies/index.js';
import { DependencyResolutionExecutor } from '../resolution/executor.js';
import { getManifestPathAtContentRoot } from '../resolution/manifest-reader.js';
import { handleListSelection } from '../list-handler.js';
import { logger } from '../../../utils/logger.js';

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
    return this.routeToHandler(preprocessResult, options, execContext);
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
    execContext: ExecutionContext
  ): Promise<CommandResult> {
    const { context, specialHandling } = result;
    
    switch (specialHandling) {
      case 'marketplace':
        return this.handleMarketplace(result, options, execContext);
      
      case 'ambiguous':
        return this.handleAmbiguous(result, options, execContext);
      
      case 'multi-resource':
        return this.handleMultiResource(result, options, execContext);
      
      default: {
        // Handle --list option (interactive resource selection)
        if (options.list) {
          return this.handleList(context, options, execContext);
        }
        
        // Normal pipeline flow: resolve platforms once if not set
        if (context.platforms.length === 0) {
          const interactive = canPrompt();
          context.platforms = await resolvePlatforms(context.targetDir, options.platforms, { interactive });
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
    const platforms =
      context.platforms.length > 0
        ? context.platforms
        : await resolvePlatforms(context.targetDir, options.platforms, { interactive: canPrompt() });

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
    execContext: ExecutionContext
  ): Promise<CommandResult> {
    const { context } = result;
    
    // Note: --list is ignored for marketplaces as they already have plugin selection
    if (options.list) {
      logger.debug('--list ignored for marketplace (already has plugin selection)');
    }
    
    if (!context.source.pluginMetadata?.manifestPath) {
      throw new Error('Marketplace manifest not found');
    }
    
    const spinner = new Spinner('Loading marketplace');
    spinner.start();
    
    const marketplace = await parseMarketplace(
      context.source.pluginMetadata.manifestPath, 
      { repoPath: context.source.contentRoot }
    );
    
    spinner.stop();
    
    let selectedPlugins: string[];
    
    if (options.plugins && options.plugins.length > 0) {
      // Non-interactive: validate provided plugin names
      const { valid, invalid } = validatePluginNames(marketplace, options.plugins);
      
      if (invalid.length > 0) {
        console.error(`Error: The following plugins were not found in marketplace '${marketplace.name}':`);
        for (const name of invalid) {
          console.error(`  - ${name}`);
        }
        console.error(`\nAvailable plugins: ${marketplace.plugins.map(p => p.name).join(', ')}`);
        return {
          success: false,
          error: `Plugins not found: ${invalid.join(', ')}`
        };
      }
      
      if (valid.length === 0) {
        console.log('No valid plugins specified. Installation cancelled.');
        return { success: true, data: { installed: 0, skipped: 0 } };
      }
      
      selectedPlugins = valid;
      console.log(`✓ Marketplace: ${marketplace.name}`);
      console.log(`Installing ${selectedPlugins.length} plugin${selectedPlugins.length === 1 ? '' : 's'}: ${selectedPlugins.join(', ')}`);
    } else {
      // Interactive: prompt user
      selectedPlugins = await promptPluginSelection(marketplace);
      
      if (selectedPlugins.length === 0) {
        console.log('No plugins selected. Installation cancelled.');
        return { success: true, data: { installed: 0, skipped: 0 } };
      }
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
      selectedPlugins,
      context.source.gitUrl,
      context.source.gitRef,
      commitSha,
      options,
      execContext,
      {
        agents: options.agents,
        skills: options.skills
      }
    );
  }
  
  /**
   * Handle ambiguous base resolution.
   * Prompts user or auto-selects, then continues to pipeline.
   */
  private async handleAmbiguous(
    result: PreprocessResult,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<CommandResult> {
    const { context, ambiguousMatches } = result;
    
    if (!ambiguousMatches || ambiguousMatches.length === 0) {
      if (context.platforms.length === 0) {
        const interactive = canPrompt();
        context.platforms = await resolvePlatforms(context.targetDir, options.platforms, { interactive });
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
    
    if (options.force || !canPrompt()) {
      selectedMatch = handleAmbiguityNonInteractive(matches);
    } else {
      const resourcePath = context.source.resourcePath || context.source.gitPath || '';
      selectedMatch = await promptBaseSelection(resourcePath, matches, repoRoot);
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
      const interactive = canPrompt();
      context.platforms = await resolvePlatforms(context.targetDir, options.platforms, { interactive });
    }
    return runUnifiedInstallPipeline(context);
  }
  
  /**
   * Handle interactive resource selection (--list option).
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
    execContext: ExecutionContext
  ): Promise<CommandResult> {
    const { context, resourceContexts, workspaceContext } = result;
    const dependencyContexts = resourceContexts ?? [];

    const needsPlatforms =
      dependencyContexts.some((ctx) => ctx.platforms.length === 0) ||
      (workspaceContext?.platforms.length === 0);

    if (needsPlatforms) {
      const interactive = canPrompt();
      const resolvedPlatforms = await resolvePlatforms(context.targetDir, options.platforms, { interactive });
      for (const ctx of dependencyContexts) {
        if (ctx.platforms.length === 0) ctx.platforms = resolvedPlatforms;
      }
      if (workspaceContext && workspaceContext.platforms.length === 0) {
        workspaceContext.platforms = resolvedPlatforms;
      }
    }

    if (dependencyContexts.length === 0 && !workspaceContext) {
      if (context.source.packageName === '__bulk__') {
        console.log('⚠️  No packages found in openpackage.yml');
        console.log('\n💡 Tips:');
        console.log('  • Add packages to the "dependencies" array in openpackage.yml');
        console.log('  • Add development packages to the "dev-dependencies" array');
        console.log('  • Use "opkg install <package-name>" to install a specific package');
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

    if (dependencyContexts.length > 0) {
      console.log(`✓ Installing ${dependencyContexts.length} package${dependencyContexts.length === 1 ? '' : 's'} from openpackage.yml`);
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

    return this.runBulkInstall(dependencyContexts);
  }

  /**
   * Run bulk install using recursive dependency resolution (graph + pipeline per package).
   */
  private async runRecursiveBulkInstall(
    options: NormalizedInstallOptions,
    execContext: ExecutionContext,
    workspaceContext?: InstallationContext | null
  ): Promise<CommandResult> {
    if (workspaceContext) {
      try {
        await runUnifiedInstallPipeline(workspaceContext);
      } catch (error) {
        logger.warn('Workspace root install failed', { error });
      }
    }

    const interactive = canPrompt();
    const platforms = await resolvePlatforms(execContext.targetDir, options.platforms, { interactive });

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
      console.log(`✓ Installation complete: ${summary.installed} installed${summary.failed > 0 ? `, ${summary.failed} failed` : ''}${summary.skipped > 0 ? `, ${summary.skipped} skipped` : ''}`);
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
   * Run bulk installation for multiple packages.
   */
  private async runBulkInstall(contexts: InstallationContext[]): Promise<CommandResult> {
    let totalInstalled = 0;
    let totalSkipped = 0;
    const results: Array<{ name: string; success: boolean; error?: string }> = [];
    
    for (const ctx of contexts) {
      try {
        const result = await runUnifiedInstallPipeline(ctx);
        
        if (result.success) {
          totalInstalled++;
          results.push({ name: ctx.source.packageName, success: true });
        } else {
          totalSkipped++;
          results.push({ name: ctx.source.packageName, success: false, error: result.error });
          console.log(`❌ ${ctx.source.packageName}: ${result.error}`);
        }
      } catch (error) {
        totalSkipped++;
        results.push({ name: ctx.source.packageName, success: false, error: String(error) });
        console.log(`❌ ${ctx.source.packageName}: ${error}`);
      }
    }
    
    // Display summary
    console.log(`✓ Installation complete: ${totalInstalled} installed${totalSkipped > 0 ? `, ${totalSkipped} failed` : ''}`);
    
    const allSuccessful = totalSkipped === 0;
    return {
      success: allSuccessful,
      data: { installed: totalInstalled, skipped: totalSkipped, results },
      error: allSuccessful ? undefined : `${totalSkipped} packages failed to install`
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
