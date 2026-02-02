import { Command } from 'commander';
import type { CommandResult, InstallOptions } from '../types/index.js';
import { withErrorHandling } from '../utils/errors.js';
import { normalizePlatforms } from '../utils/platform-mapper.js';
import { buildInstallContext, buildResourceInstallContext, buildResourceInstallContexts } from '../core/install/unified/context-builders.js';
import { runUnifiedInstallPipeline } from '../core/install/unified/pipeline.js';
import { runMultiContextPipeline } from '../core/install/unified/multi-context-pipeline.js';
import { determineResolutionMode } from '../utils/resolution-mode.js';
import { DIR_PATTERNS, PACKAGE_PATHS } from '../constants/index.js';
import { normalizePathForProcessing } from '../utils/path-normalization.js';
import type { InstallationContext } from '../core/install/unified/context.js';
import type { LoadedPackage } from '../core/install/sources/base.js';
import { getLoaderForSource } from '../core/install/sources/loader-factory.js';
import { logger } from '../utils/logger.js';
import { parseResourceArg } from '../utils/resource-arg-parser.js';
import { applyConvenienceFilters, displayFilterErrors } from '../core/install/convenience-matchers.js';
import { promptBaseSelection, canPrompt, handleAmbiguityNonInteractive, type BaseMatch } from '../core/install/ambiguity-prompts.js';
import { join, relative } from 'path';

/**
 * Validate that target directory is not inside .openpackage metadata
 */
function assertTargetDirOutsideMetadata(targetDir: string): void {
  const normalized = normalizePathForProcessing(targetDir ?? '.');
  if (!normalized || normalized === '.') {
    return; // default install root
  }

  if (
    normalized === DIR_PATTERNS.OPENPACKAGE ||
    normalized.startsWith(`${DIR_PATTERNS.OPENPACKAGE}/`)
  ) {
    throw new Error(
      `Installation target '${targetDir}' cannot point inside ${DIR_PATTERNS.OPENPACKAGE} ` +
      `(reserved for metadata like ${PACKAGE_PATHS.INDEX_RELATIVE}). ` +
      `Choose a workspace path outside metadata.`
    );
  }
}

/**
 * Validate resolution flags
 */
export function validateResolutionFlags(options: InstallOptions & { local?: boolean; remote?: boolean }): void {
  if (options.remote && options.local) {
    throw new Error('--remote and --local cannot be used together. Choose one resolution mode.');
  }
}

/**
 * Normalize --plugins option value by deduplicating.
 * Since --plugins is now variadic (space-separated), we receive an array directly.
 *
 * @param value - Array of plugin names from variadic option, or undefined
 * @returns Array of unique plugin names, or undefined if empty/not provided
 */
export function normalizePluginsOption(value: string[] | undefined): string[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }

  // Deduplicate
  const plugins = [...new Set(value)];

  return plugins.length > 0 ? plugins : undefined;
}

/**
 * Main install command handler
 */
async function installCommand(
  packageInput: string | undefined,
  options: InstallOptions
): Promise<CommandResult> {
  const cwd = process.cwd();
  const targetDir = '.';
  
  // Validate inputs
  assertTargetDirOutsideMetadata(targetDir);
  validateResolutionFlags(options);
  
  // Set resolution mode
  options.resolutionMode = determineResolutionMode(options);
  
  // No input = bulk install (unchanged)
  if (!packageInput) {
    const contexts = await buildInstallContext(cwd, packageInput, options);
    if (Array.isArray(contexts)) {
      return await runBulkInstall(contexts);
    }
    // Shouldn't happen, but handle gracefully
    return await runUnifiedInstallPipeline(contexts as InstallationContext);
  }
  
  // Check if we have convenience options (--agents, --skills)
  const hasConvenienceOptions = !!(options as any).agents || !!(options as any).skills;
  
  // Try parsing as resource first if:
  // 1. We have convenience options, OR
  // 2. Input looks like it might have a sub-path (contains more than 2 segments after gh@)
  const shouldTryResourceParsing = hasConvenienceOptions || 
    packageInput.startsWith('gh@') || 
    packageInput.startsWith('http');
  
  if (shouldTryResourceParsing) {
    try {
      return await installResourceCommand(packageInput, options, cwd);
    } catch (error) {
      // If resource parsing fails and no convenience options, fall back to legacy
      if (!hasConvenienceOptions) {
        logger.debug('Resource parsing failed, falling back to legacy install', { error });
      } else {
        // With convenience options, resource parsing is required
        throw error;
      }
    }
  }
  
  // Fall back to legacy install for backwards compatibility
  return await installLegacyCommand(packageInput, options, cwd);
}

/**
 * Install command using resource model (Phase 3)
 */
async function installResourceCommand(
  packageInput: string,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  // Parse resource argument
  const resourceSpec = await parseResourceArg(packageInput, cwd);
  
  logger.debug('Parsed resource spec', { resourceSpec });
  
  // Build context from resource spec
  let context = await buildResourceInstallContext(cwd, resourceSpec, options);
  
  // Load the source to get content and detect base
  const loader = getLoaderForSource(context.source);
  const loaded = await loader.load(context.source, options, cwd);
  
  // Update context with loaded info
  context.source.packageName = loaded.packageName;
  context.source.version = loaded.version;
  context.source.contentRoot = loaded.contentRoot;
  context.source.pluginMetadata = loaded.pluginMetadata;
  
  // Store commitSha for marketplace handling
  if (loaded.sourceMetadata?.commitSha) {
    (context.source as any)._commitSha = loaded.sourceMetadata.commitSha;
  }

  // Marketplace shortcut: some loaders set pluginType without baseDetection results.
  // If this is a marketplace, delegate to marketplace handler so --plugins works as intended.
  if (loaded.pluginMetadata?.pluginType === 'marketplace') {
    return await handleMarketplaceInstallation(context, options, cwd);
  }
  
  // Base detection is already done in the source loader (Phase 2)
  // Check if we have base detection results in sourceMetadata
  if (loaded.sourceMetadata?.baseDetection) {
    const baseDetection = loaded.sourceMetadata.baseDetection;
    context.detectedBase = baseDetection.base;
    context.matchedPattern = baseDetection.matchedPattern;
    context.baseSource = baseDetection.matchType as any;
    
    // Handle marketplace detection
    if (baseDetection.matchType === 'marketplace') {
      return await handleMarketplaceInstallation(context, options, cwd);
    }
    
    // Handle ambiguous base detection (before pipeline)
    if (baseDetection.matchType === 'ambiguous' && baseDetection.ambiguousMatches) {
      context = await handleAmbiguousBase(context, baseDetection.ambiguousMatches, cwd, options);
    }
    
    // Calculate base relative to repo root for manifest storage
    if (context.detectedBase && loaded.contentRoot) {
      context.baseRelative = relative(loaded.contentRoot, context.detectedBase);
      if (!context.baseRelative) {
        context.baseRelative = '.'; // Base is repo root
      }
    }
  }

  // If user specified a concrete sub-path (dir or file), we must scope installs to it.
  // Base detection chooses the base, but does NOT imply "install everything matching that flow".
  if (resourceSpec.path) {
    const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot || context.detectedBase || cwd;
    const baseAbs = context.detectedBase || loaded.contentRoot || cwd;
    const absResourcePath = join(repoRoot, resourceSpec.path);
    const relativeToBase = relative(baseAbs, absResourcePath).replace(/\\/g, '/').replace(/^\.\/?/, '');

    // Only scope if the resource path sits within the detected base.
    if (relativeToBase && !relativeToBase.startsWith('..')) {
      let isDirectory = false;
      try {
        const stat = await import('fs/promises').then(m => m.stat(absResourcePath));
        isDirectory = stat.isDirectory();
      } catch {
        // If stat fails, keep existing matchedPattern (base-level filtering only).
      }

      const scopedPattern = isDirectory
        ? `${relativeToBase.replace(/\/$/, '')}/**`
        : relativeToBase;

      context.matchedPattern = scopedPattern;
    }
  }
  
  // Apply convenience filters if specified (--agents, --skills)
  if ((options as any).agents || (options as any).skills) {
    const basePath = context.detectedBase || loaded.contentRoot || cwd;
    const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot || basePath;
    
    const filterResult = await applyConvenienceFilters(basePath, repoRoot, {
      agents: (options as any).agents,
      skills: (options as any).skills
    });
    
    // Display errors if any
    if (filterResult.errors.length > 0) {
      displayFilterErrors(filterResult.errors);
      
      // If all resources failed, abort
      if (filterResult.resources.length === 0) {
        return {
          success: false,
          error: 'None of the requested resources were found'
        };
      }
      
      // Otherwise, continue with partial install
      console.log(`\n⚠️  Continuing with ${filterResult.resources.length} resource(s)\n`);
    }

    const resourceContexts = buildResourceInstallContexts(context, filterResult.resources, repoRoot);
    return await runMultiContextPipeline(resourceContexts);
  }
  
  // Not a marketplace or ambiguous - warn if --plugins was specified without agents/skills
  if (options.plugins && options.plugins.length > 0 && 
      !(options as any).agents && !(options as any).skills) {
    console.log('Warning: --plugins flag is only used with marketplace sources. Ignoring.');
  }
  
  // Create resolved package for the loaded package
  // Map source type to ResolvedPackage source type
  const resolvedSource: 'local' | 'remote' | 'path' | 'git' = 
    context.source.type === 'registry' ? 'local' :
    context.source.type === 'workspace' ? 'local' :
    context.source.type; // 'path' or 'git' map directly
  
  context.resolvedPackages = [{
    name: loaded.packageName,
    version: loaded.version,
    pkg: { metadata: loaded.metadata, files: [], _format: undefined },
    isRoot: true,
    source: resolvedSource,
    contentRoot: context.detectedBase || loaded.contentRoot
  }];
  
  // Run pipeline
  return await runUnifiedInstallPipeline(context);
}

/**
 * Legacy install command (backwards compatible)
 */
async function installLegacyCommand(
  packageInput: string,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  // Build context(s) using legacy method
  const contexts = await buildInstallContext(cwd, packageInput, options);
  
  // Handle bulk install (shouldn't happen here, but keep for safety)
  if (Array.isArray(contexts)) {
    return await runBulkInstall(contexts);
  }
  
  // For git sources, we need to load the package first to detect if it's a marketplace
  if (contexts.source.type === 'git') {
    const loader = getLoaderForSource(contexts.source);
    const loaded = await loader.load(contexts.source, options, cwd);
    
    // Update context with loaded info
    contexts.source.packageName = loaded.packageName;
    contexts.source.version = loaded.version;
    contexts.source.contentRoot = loaded.contentRoot;
    contexts.source.pluginMetadata = loaded.pluginMetadata;
    
    // Store commitSha for marketplace handling
    if (loaded.sourceMetadata?.commitSha) {
      (contexts.source as any)._commitSha = loaded.sourceMetadata.commitSha;
    }
    
    // Check if marketplace - handle at command level
    if (contexts.source.pluginMetadata?.pluginType === 'marketplace') {
      return await handleMarketplaceInstallation(contexts, options, cwd);
    }

    // Not a marketplace - warn if --plugins was specified
    if (options.plugins && options.plugins.length > 0) {
      console.log('Warning: --plugins flag is only used with marketplace sources. Ignoring.');
    }

    // Create resolved package for the loaded package
    contexts.resolvedPackages = [{
      name: loaded.packageName,
      version: loaded.version,
      pkg: { metadata: loaded.metadata, files: [], _format: undefined },
      isRoot: true,
      source: 'git',
      contentRoot: loaded.contentRoot
    }];
  }
  
  // Single package install
  return await runUnifiedInstallPipeline(contexts);
}

/**
 * Handle ambiguous base detection with user prompt or auto-selection
 */
async function handleAmbiguousBase(
  context: InstallationContext,
  ambiguousMatches: Array<{ pattern: string; base: string; startIndex: number }>,
  cwd: string,
  options: InstallOptions
): Promise<InstallationContext> {
  const repoRoot = context.source.contentRoot || cwd;
  
  // Convert to BaseMatch format for prompt
  const matches: BaseMatch[] = ambiguousMatches.map(m => ({
    base: m.base,
    pattern: m.pattern,
    startIndex: m.startIndex,
    exampleTarget: `${m.pattern} → <platforms>/${m.pattern.replace('**/', '').replace('*', 'file')}`
  }));
  
  let selectedMatch: BaseMatch;
  
  // Check if we can prompt
  if (options.force || !canPrompt()) {
    // Non-interactive mode or --force: use deepest match
    selectedMatch = handleAmbiguityNonInteractive(matches);
  } else {
    // Interactive mode: prompt user
    const resourcePath = context.source.resourcePath || context.source.gitPath || '';
    selectedMatch = await promptBaseSelection(resourcePath, matches, repoRoot);
  }
  
  // Update context with selected base
  context.detectedBase = selectedMatch.base;
  context.matchedPattern = selectedMatch.pattern;
  context.baseSource = 'user-selection'; // Mark as user-selected for manifest
  
  // Calculate relative base for manifest
  context.baseRelative = relative(repoRoot, selectedMatch.base);
  if (!context.baseRelative) {
    context.baseRelative = '.';
  }
  
  logger.info('Ambiguous base resolved', {
    base: context.detectedBase,
    pattern: context.matchedPattern,
    source: context.baseSource
  });
  
  return context;
}

/**
 * Handle marketplace installation with plugin selection
 */
async function handleMarketplaceInstallation(
  context: InstallationContext,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const {
    parseMarketplace,
    promptPluginSelection,
    installMarketplacePlugins,
    validatePluginNames
  } = await import('../core/install/marketplace-handler.js');
  const { Spinner } = await import('../utils/spinner.js');

  // Load the marketplace package (already loaded, use context data)
  if (!context.source.pluginMetadata?.manifestPath) {
    throw new Error('Marketplace manifest not found');
  }

  const spinner = new Spinner('Loading marketplace');
  spinner.start();

  // Parse marketplace manifest
  const marketplace = await parseMarketplace(context.source.pluginMetadata.manifestPath, {
    repoPath: context.source.contentRoot
  });

  spinner.stop();

  let selectedPlugins: string[];

  // Check if --plugins flag was provided
  if (options.plugins && options.plugins.length > 0) {
    // Non-interactive mode: validate and use provided plugin names
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
    // Interactive mode: prompt user to select plugins
    selectedPlugins = await promptPluginSelection(marketplace);

    if (selectedPlugins.length === 0) {
      console.log('No plugins selected. Installation cancelled.');
      return { success: true, data: { installed: 0, skipped: 0 } };
    }
  }

  // Install selected plugins using marketplace handler
  // At this point we know it's a git source with a gitUrl
  if (context.source.type !== 'git' || !context.source.gitUrl) {
    throw new Error('Marketplace must be from a git source');
  }

  // Get commitSha from source metadata
  const commitSha = (context.source as any)._commitSha || '';
  if (!commitSha) {
    logger.error('Marketplace commit SHA not available', {
      source: context.source,
      hasSourceMetadata: !!(context.source as any).sourceMetadata,
      _commitSha: (context.source as any)._commitSha
    });
    throw new Error('Marketplace commit SHA not available. Please report this issue.');
  }

  return await installMarketplacePlugins(
    context.source.contentRoot!,
    marketplace,
    selectedPlugins,
    context.source.gitUrl,
    context.source.gitRef,
    commitSha,
    options,
    cwd,
    {
      agents: (options as any).agents,
      skills: (options as any).skills
    }
  );
}

/**
 * Run bulk installation for multiple packages
 */
async function runBulkInstall(contexts: InstallationContext[]): Promise<CommandResult> {
  if (contexts.length === 0) {
    console.log('⚠️  No packages found in openpackage.yml');
    console.log('\n💡 Tips:');
    console.log('  • Add packages to the "dependencies" array in openpackage.yml');
    console.log('  • Add development packages to the "dev-dependencies" array');
    console.log('  • Use "opkg install <package-name>" to install a specific package');
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  console.log(`✓ Installing ${contexts.length} package${contexts.length === 1 ? '' : 's'} from openpackage.yml`);
  
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

/**
 * Setup install command
 */
export function setupInstallCommand(program: Command): void {
  program
    .command('install')
    .alias('i')
    .description('Install packages to workspace')
    .argument(
      '[package-name]',
      'name of the package to install (optional - installs workspace-level files and all packages from openpackage.yml if not specified). ' +
      'Supports package@version syntax.'
    )
    .option('--dry-run', 'preview changes without applying them')
    .option('--force', 'overwrite existing files')
    .option('--conflicts <strategy>', 'conflict handling strategy: keep-both, overwrite, skip, or ask')
    .option('--dev', 'add package to dev-dependencies instead of dependencies')
    .option('--platforms <platforms...>', 'prepare specific platforms (e.g., cursor claudecode opencode)')
    .option('--remote', 'pull and install from remote registry, ignoring local versions')
    .option('--local', 'resolve and install using only local registry versions, skipping remote metadata and pulls')
    .option('--profile <profile>', 'profile to use for authentication')
    .option('--api-key <key>', 'API key for authentication (overrides profile)')
    .option('--plugins <names...>', 'install specific plugins from marketplace (bypasses interactive selection)')
    .option('--agents <names...>', 'install specific agents by name (matches frontmatter name or filename)')
    .option('--skills <names...>', 'install specific skills by name (matches SKILL.md frontmatter name or directory name)')
    .action(withErrorHandling(async (packageName: string | undefined, options: InstallOptions & { agents?: string[]; skills?: string[] }) => {
      // Normalize platforms
      options.platforms = normalizePlatforms(options.platforms);

      // Normalize plugins
      if (options.plugins) {
        options.plugins = normalizePluginsOption(options.plugins as any);
      }

      // Normalize conflict strategy
      const commandOptions = options as InstallOptions & { conflicts?: string };
      const rawConflictStrategy = commandOptions.conflicts ?? options.conflictStrategy;
      if (rawConflictStrategy) {
        const normalizedStrategy = (rawConflictStrategy as string).toLowerCase();
        const allowedStrategies: InstallOptions['conflictStrategy'][] = [
          'keep-both', 'overwrite', 'skip', 'ask'
        ];
        if (!allowedStrategies.includes(normalizedStrategy as InstallOptions['conflictStrategy'])) {
          throw new Error(
            `Invalid --conflicts value '${rawConflictStrategy}'. ` +
            `Use one of: keep-both, overwrite, skip, ask.`
          );
        }
        options.conflictStrategy = normalizedStrategy as InstallOptions['conflictStrategy'];
      }

      // Execute install
      const result = await installCommand(packageName, options);
      
      if (!result.success) {
        if (result.error === 'Package not found') {
          return; // Already displayed message
        }
        throw new Error(result.error || 'Installation operation failed');
      }
    }));
}
