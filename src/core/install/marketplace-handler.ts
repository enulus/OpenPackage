import { join, basename, relative, resolve } from 'path';
import { readTextFile, exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { ValidationError, UserCancellationError } from '../../utils/errors.js';
import { buildGitInstallContext, buildPathInstallContext, buildResourceInstallContexts } from './unified/context-builders.js';
import type { InstallationContext } from './unified/context.js';
import { runUnifiedInstallPipeline } from './unified/pipeline.js';
import { detectPluginType, detectPluginWithMarketplace, validatePluginManifest } from './plugin-detector.js';
import { Spinner } from '../../utils/spinner.js';
import type { CommandResult, InstallOptions, ExecutionContext } from '../../types/index.js';
import { CLAUDE_PLUGIN_PATHS } from '../../constants/index.js';
import { runMultiContextPipeline } from './unified/multi-context-pipeline.js';
import { getLoaderForSource } from './sources/loader-factory.js';
import { applyBaseDetection } from './preprocessing/base-resolver.js';
import { resolveConvenienceResources } from './preprocessing/convenience-preprocessor.js';
import { discoverResources } from './resource-discoverer.js';
import { promptResourceSelection, displaySelectionSummary } from './resource-selection-menu.js';
import { select, isCancel, note, cancel } from '@clack/prompts';
import { output } from '../../utils/output.js';
import type { ResourceInstallationSpec } from './convenience-matchers.js';
import type { SelectedResource } from './resource-types.js';
import {
  normalizePluginSource,
  isRelativePathSource,
  isGitSource,
  type PluginSourceSpec,
  type NormalizedPluginSource
} from './plugin-sources.js';

/**
 * Claude Code marketplace manifest schema.
 * See: https://code.claude.com/docs/en/plugin-marketplaces
 */
export interface MarketplaceManifest {
  name: string;
  description?: string;
  homepage?: string;
  plugins: MarketplacePluginEntry[];
}

/**
 * Marketplace plugin entry.
 * Each entry defines a plugin and where to find it.
 * When strict is false, all plugin metadata can be defined here instead of in plugin.json.
 */
export interface MarketplacePluginEntry {
  // Required fields
  name: string;
  source: PluginSourceSpec;
  
  // Standard metadata fields
  description?: string;
  version?: string;
  author?: {
    name?: string;
    email?: string;
    url?: string;
  };
  homepage?: string;
  repository?: string | {
    type?: string;
    url?: string;
  };
  license?: string;
  keywords?: string[];
  category?: string;
  tags?: string[];
  
  // Component configuration fields
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | object;
  mcpServers?: string | object;
  lspServers?: string | object;
  
  // Strictness control
  strict?: boolean;
}

/**
 * Parse and validate a marketplace manifest.
 * 
 * @param manifestPath - Path to marketplace.json file
 * @param context - Context for fallback naming
 * @returns Parsed marketplace manifest
 */
export async function parseMarketplace(
  manifestPath: string,
  context?: { gitUrl?: string; repoPath?: string }
): Promise<MarketplaceManifest> {
  logger.debug('Parsing marketplace manifest', { manifestPath, context });
  
  try {
    const content = await readTextFile(manifestPath);
    const manifest = JSON.parse(content) as MarketplaceManifest;
    
    // If name is missing, use fallback from repo name
    if (!manifest.name && context?.repoPath) {
      manifest.name = basename(context.repoPath);
      logger.debug('Marketplace name missing, using repo name as fallback', { name: manifest.name });
    }
    
    // Validate required fields
    if (!manifest.name) {
      throw new ValidationError('Marketplace manifest missing required field: name');
    }
    
    if (!manifest.plugins || !Array.isArray(manifest.plugins)) {
      throw new ValidationError('Marketplace manifest missing or invalid plugins array');
    }
    
    if (manifest.plugins.length === 0) {
      throw new ValidationError('Marketplace contains no plugins');
    }
    
    // Validate each plugin entry
    for (const plugin of manifest.plugins) {
      if (!plugin.name) {
        throw new ValidationError('Marketplace plugin entry missing required field: name');
      }
      if (!plugin.source) {
        throw new ValidationError(`Plugin '${plugin.name}' missing required field: source`);
      }
      
      // Validate source can be normalized (will throw if invalid)
      try {
        normalizePluginSource(plugin.source, plugin.name);
      } catch (error) {
        throw new ValidationError(
          `Plugin '${plugin.name}' has invalid source: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    
    logger.info('Parsed marketplace manifest', {
      name: manifest.name,
      pluginCount: manifest.plugins.length
    });
    
    return manifest;
    
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(`Failed to parse marketplace manifest at ${manifestPath}: ${error}`);
  }
}

/**
 * Display interactive plugin selection prompt using single selection.
 * 
 * @param marketplace - Parsed marketplace manifest
 * @returns Selected plugin name (empty string if user cancelled)
 */
export async function promptPluginSelection(
  marketplace: MarketplaceManifest
): Promise<string> {
  // Display marketplace info using clack log
  output.info(`Marketplace: ${marketplace.name}`);
  if (marketplace.description) {
    output.message(marketplace.description);
  }

  const options = marketplace.plugins
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(plugin => ({
      value: plugin.name,
      label: plugin.name,
      hint: plugin.description || ''
    }));
  
  try {
    const selectedPlugin = await select({
      message: 'Select a plugin to install:',
      options
    });
    
    if (isCancel(selectedPlugin)) {
      logger.info('User cancelled plugin selection');
      return '';
    }
    
    logger.info('User selected plugin', { selected: selectedPlugin });
    return selectedPlugin as string;
  } catch (error) {
    if (error instanceof UserCancellationError) {
      logger.info('User cancelled plugin selection');
      return '';
    }
    throw error;
  }
}

/**
 * Install mode type
 */
export type InstallMode = 'full' | 'partial';

/**
 * Prompt user to choose between full plugin install or partial (individual resources).
 * 
 * @param pluginName - Name of the plugin being installed
 * @returns Install mode ('full' or 'partial'), or empty string if cancelled
 */
export async function promptInstallMode(pluginName: string): Promise<InstallMode | ''> {
  try {
    const mode = await select({
      message: `How would you like to install ${pluginName}?`,
      options: [
        { 
          value: 'full', 
          label: 'Install full plugin', 
          hint: 'Install all resources from this plugin' 
        },
        { 
          value: 'partial', 
          label: 'Select individual resources', 
          hint: 'Choose specific agents, skills, commands, etc.' 
        }
      ]
    });
    
    if (isCancel(mode)) {
      logger.info('User cancelled install mode selection');
      return '';
    }
    
    logger.info('User selected install mode', { mode });
    return mode as InstallMode;
  } catch (error) {
    if (error instanceof UserCancellationError) {
      logger.info('User cancelled install mode selection');
      return '';
    }
    throw error;
  }
}

/**
 * Install individual resources from a plugin (partial install mode).
 * Discovers resources and prompts user to select which ones to install.
 * 
 * @param pluginDir - Absolute path to plugin directory
 * @param pluginEntry - Marketplace plugin entry
 * @param context - Installation context with source metadata
 * @param repoRoot - Repository root path
 * @returns Command result
 */
async function installPluginPartial(
  pluginDir: string,
  pluginEntry: MarketplacePluginEntry,
  context: any,
  repoRoot: string
): Promise<CommandResult> {
  logger.info('Starting partial plugin installation', {
    plugin: pluginEntry.name,
    path: pluginDir
  });
  
  // Discover all resources with spinner
  const s = output.spinner();
  s.start('Discovering resources');
  
  const discovery = await discoverResources(pluginDir, repoRoot);
  
  // Stop spinner with completion message
  if (discovery.total === 0) {
    s.stop('No resources found');
  } else {
    s.stop(`${discovery.total} resource${discovery.total === 1 ? '' : 's'} discovered`);
  }
  
  // Check if any resources found
  if (discovery.total === 0) {
    output.warn('No installable resources found in this plugin');
    return {
      success: true,
      data: { installed: 0, skipped: 0 }
    };
  }
  
  // Prompt for resource selection
  const selected: SelectedResource[] = await promptResourceSelection(
    discovery,
    context.source.packageName || pluginEntry.name,
    context.source.version
  );
  
  if (selected.length === 0) {
    cancel('No resources selected. Installation cancelled.');
    return {
      success: true,
      data: { installed: 0, skipped: 0 }
    };
  }
  
  // Display selection summary
  displaySelectionSummary(selected);
  
  // Convert selected resources to ResourceInstallationSpec format
  const resourceSpecs: ResourceInstallationSpec[] = selected.map(s => ({
    name: s.displayName,
    resourceType: s.resourceType as 'agent' | 'skill' | 'command' | 'rule',
    resourcePath: s.resourcePath,
    basePath: resolve(pluginDir),
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

/**
 * Install selected plugins from a marketplace.
 * 
 * @param marketplaceDir - Absolute path to cloned marketplace repository root
 * @param marketplace - Parsed marketplace manifest
 * @param selectedName - Name of plugin to install
 * @param installMode - Install mode ('full' or 'partial')
 * @param marketplaceGitUrl - Git URL of the marketplace repository
 * @param marketplaceGitRef - Git ref (branch/tag/sha) if specified
 * @param marketplaceCommitSha - Commit SHA of cached marketplace
 * @param options - Install options
 * @param cwd - Current working directory for installation
 */
export async function installMarketplacePlugins(
  marketplaceDir: string,
  marketplace: MarketplaceManifest,
  selectedName: string,
  installMode: InstallMode,
  marketplaceGitUrl: string,
  marketplaceGitRef: string | undefined,
  marketplaceCommitSha: string,
  options: InstallOptions,
  execContext: ExecutionContext,
  convenienceOptions?: { agents?: string[]; skills?: string[]; rules?: string[]; commands?: string[] }
): Promise<CommandResult> {
  logger.info('Installing marketplace plugin', { 
    marketplace: marketplace.name,
    plugin: selectedName,
    mode: installMode
  });
  
  const pluginEntry = marketplace.plugins.find(p => p.name === selectedName);
  if (!pluginEntry) {
    const error = `Plugin '${selectedName}' not found in marketplace`;
    logger.error(error, { marketplace: marketplace.name });
    output.error(`${selectedName}: ${error}`);
    return { success: false, error };
  }
  
  // Normalize the plugin source
  let normalizedSource: NormalizedPluginSource;
  try {
    normalizedSource = normalizePluginSource(pluginEntry.source, selectedName);
  } catch (error) {
    logger.error('Failed to normalize plugin source', { plugin: selectedName, error });
    const errorMsg = error instanceof Error ? error.message : 'Invalid source configuration';
    output.error(`${selectedName}: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
  
  // Install based on source type
  try {
    let installResult: CommandResult;
    
    if (isRelativePathSource(normalizedSource)) {
      installResult = await installRelativePathPlugin(
        marketplaceDir,
        marketplace,
        pluginEntry,
        normalizedSource,
        installMode,
        marketplaceGitUrl,
        marketplaceGitRef,
        marketplaceCommitSha,
        options,
        execContext,
        convenienceOptions
      );
    } else if (isGitSource(normalizedSource)) {
      installResult = await installGitPlugin(
        marketplace,
        pluginEntry,
        normalizedSource,
        installMode,
        options,
        execContext,
        convenienceOptions
      );
    } else {
      throw new Error(`Unsupported source type: ${normalizedSource.type}`);
    }
    
    return installResult;
    
  } catch (error) {
    logger.error('Failed to install plugin', { plugin: selectedName, error });
    const errorMsg = error instanceof Error ? error.message : String(error);
    output.error(`${selectedName}: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Install a plugin from a relative path within the marketplace repository.
 */
async function installRelativePathPlugin(
  marketplaceDir: string,
  marketplace: MarketplaceManifest,
  pluginEntry: MarketplacePluginEntry,
  normalizedSource: NormalizedPluginSource,
  installMode: InstallMode,
  marketplaceGitUrl: string,
  marketplaceGitRef: string | undefined,
  marketplaceCommitSha: string,
  options: InstallOptions,
  execContext: ExecutionContext,
  convenienceOptions?: { agents?: string[]; skills?: string[]; rules?: string[]; commands?: string[] }
): Promise<CommandResult> {
  const pluginSubdir = normalizedSource.relativePath!;
  const pluginDir = join(marketplaceDir, pluginSubdir);
  
  // Validate plugin subdirectory exists (silent for partial mode)
  if (!(await exists(pluginDir))) {
    const error = `Path '${pluginSubdir}' does not exist in marketplace repository`;
    logger.error('Plugin path not found', { 
      plugin: pluginEntry.name, 
      path: pluginSubdir,
      fullPath: pluginDir
    });
    output.error(`${pluginEntry.name}: ${error}`);
    return { success: false, error };
  }
  
  const hasConvenienceOptions = Boolean(convenienceOptions?.agents?.length || convenienceOptions?.skills?.length || convenienceOptions?.rules?.length || convenienceOptions?.commands?.length);

  if (hasConvenienceOptions) {
    logger.info('Convenience filters active, bypassing full plugin validation', {
      plugin: pluginEntry.name,
      path: pluginSubdir
    });

    const ctx = await buildPathInstallContext(
      execContext,
      pluginDir,
      {
        ...options,
        sourceType: 'directory' as const
      }
    );

    ctx.source.gitSourceOverride = {
      gitUrl: marketplaceGitUrl,
      gitRef: marketplaceGitRef,
      gitPath: pluginSubdir
    };

    ctx.source.pluginMetadata = {
      isPlugin: true,
      marketplaceEntry: pluginEntry,
      marketplaceSource: {
        url: marketplaceGitUrl,
        commitSha: marketplaceCommitSha,
        pluginName: pluginEntry.name
      }
    };

    ctx.detectedBase = pluginDir;
    ctx.baseRelative = relative(marketplaceDir, pluginDir) || '.';

    const resources = await resolveConvenienceResources(pluginDir, marketplaceDir, convenienceOptions ?? {});

    const resourceContexts = buildResourceInstallContexts(ctx, resources, marketplaceDir).map(rc => {
      if (rc.source.type === 'path') {
        rc.source.localPath = marketplaceDir;
      }
      return rc;
    });
    const multiResult = await runMultiContextPipeline(resourceContexts);
    return {
      success: multiResult.success,
      error: multiResult.error
    };
  }

  // Build path context for the already-cloned plugin directory
  const ctx = await buildPathInstallContext(
    execContext,
    pluginDir,
    {
      ...options,
      sourceType: 'directory' as const
    }
  );
  
  // Add git source override for manifest recording
  ctx.source.gitSourceOverride = {
    gitUrl: marketplaceGitUrl,
    gitRef: marketplaceGitRef,
    gitPath: pluginSubdir
  };
  
  // Add marketplace metadata to context
  ctx.source.pluginMetadata = {
    isPlugin: true,
    marketplaceEntry: pluginEntry,
    marketplaceSource: {
      url: marketplaceGitUrl,
      commitSha: marketplaceCommitSha,
      pluginName: pluginEntry.name
    }
  };

  // Branch based on install mode
  if (installMode === 'partial') {
    // Partial install: prompt for resource selection
    logger.info('Using partial install mode for relative path plugin', {
      plugin: pluginEntry.name,
      path: pluginSubdir
    });
    
    ctx.detectedBase = pluginDir;
    ctx.baseRelative = relative(marketplaceDir, pluginDir) || '.';
    
    const repoRoot = marketplaceDir;
    return await installPluginPartial(pluginDir, pluginEntry, ctx, repoRoot);
  }

  // Full install: validate and install entire plugin
  logger.info('Using full install mode for relative path plugin', {
    plugin: pluginEntry.name,
    path: pluginSubdir
  });

  // Show validation/install spinner for full mode only
  const installSpinner = output.spinner();
  installSpinner.start(`Installing ${pluginEntry.name}`);

  // Validate plugin structure with marketplace context
  const detection = await detectPluginWithMarketplace(pluginDir, pluginEntry);
  
  if (!detection.isPlugin) {
    const strictInfo = pluginEntry.strict === false 
      ? ' Set "strict": false in marketplace entry if this plugin is defined entirely in marketplace.json.'
      : '';
    const error = `Path '${pluginSubdir}' does not contain a valid plugin.${strictInfo}`;
    logger.error('Invalid plugin structure', { 
      plugin: pluginEntry.name, 
      path: pluginSubdir,
      strict: pluginEntry.strict
    });
    installSpinner.stop();
    output.error(`${pluginEntry.name}: ${error}`);
    return { success: false, error };
  }
  
  // For plugins with plugin.json, validate it's parseable
  if (detection.manifestPath) {
    if (!(await validatePluginManifest(detection.manifestPath))) {
      const error = `Invalid plugin manifest in '${pluginSubdir}' (cannot parse JSON)`;
      logger.error('Invalid plugin manifest', { plugin: pluginEntry.name });
      installSpinner.stop();
      output.error(`${pluginEntry.name}: ${error}`);
      return { success: false, error };
    }
  }
  
  // Update context with detection results
  ctx.source.pluginMetadata = {
    ...ctx.source.pluginMetadata,
    pluginType: detection.type as any,
    manifestPath: detection.manifestPath
  };
  
  const pipelineResult = await runUnifiedInstallPipeline(ctx);
  
  // Get the actual generated name from the loaded package
  const installedName = ctx.source.packageName || pluginEntry.name;
  
  if (pipelineResult.success) {
    installSpinner.stop();
    output.success(installedName);
  } else {
    installSpinner.stop();
    output.error(`${installedName}: ${pipelineResult.error || 'Unknown error'}`);
  }
  
  return {
    success: pipelineResult.success,
    error: pipelineResult.error
  };
}

/**
 * Install a plugin from an external git repository.
 */
async function installGitPlugin(
  marketplace: MarketplaceManifest,
  pluginEntry: MarketplacePluginEntry,
  normalizedSource: NormalizedPluginSource,
  installMode: InstallMode,
  options: InstallOptions,
  execContext: ExecutionContext,
  convenienceOptions?: { agents?: string[]; skills?: string[]; rules?: string[]; commands?: string[] }
): Promise<CommandResult> {
  const gitUrl = normalizedSource.gitUrl!;
  const gitRef = normalizedSource.gitRef;
  const gitPath = normalizedSource.gitPath;
  
  logger.info('Installing git plugin', {
    plugin: pluginEntry.name,
    gitUrl,
    gitRef,
    gitPath
  });
  
  // Build git context
  const ctx = await buildGitInstallContext(
    execContext,
    gitUrl,
    {
      ...options,
      gitRef,
      gitPath
    }
  );
  
  // Add marketplace metadata for proper scoping
  ctx.source.pluginMetadata = {
    isPlugin: true,
    marketplaceEntry: pluginEntry
  };

  const hasConvenienceOptions = Boolean(convenienceOptions?.agents?.length || convenienceOptions?.skills?.length || convenienceOptions?.rules?.length || convenienceOptions?.commands?.length);
  if (hasConvenienceOptions) {
    const loader = getLoaderForSource(ctx.source);
    const loaded = await loader.load(ctx.source, options, execContext);

    ctx.source.packageName = loaded.packageName;
    ctx.source.version = loaded.version;
    ctx.source.contentRoot = loaded.contentRoot;
    ctx.source.pluginMetadata = {
      ...loaded.pluginMetadata,
      ...(ctx.source.pluginMetadata ?? {}),
      marketplaceEntry: pluginEntry
    };

    if (loaded.sourceMetadata?.commitSha) {
      (ctx.source as any)._commitSha = loaded.sourceMetadata.commitSha;
    }

    if (loaded.sourceMetadata?.baseDetection) {
      applyBaseDetection(ctx, loaded);
    }

    const basePath = ctx.detectedBase || loaded.contentRoot || execContext.targetDir;
    const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot || basePath;
    const resources = await resolveConvenienceResources(basePath, repoRoot, convenienceOptions ?? {});

    const resourceContexts = buildResourceInstallContexts(ctx, resources, repoRoot);
    const multiResult = await runMultiContextPipeline(resourceContexts);
    return {
      success: multiResult.success,
      error: multiResult.error
    };
  }

  // Branch based on install mode
  if (installMode === 'partial') {
    // Partial install: load plugin, discover resources, prompt for selection
    logger.info('Using partial install mode for git plugin', {
      plugin: pluginEntry.name
    });

    const loader = getLoaderForSource(ctx.source);
    const loaded = await loader.load(ctx.source, options, execContext);

    ctx.source.packageName = loaded.packageName;
    ctx.source.version = loaded.version;
    ctx.source.contentRoot = loaded.contentRoot;
    ctx.source.pluginMetadata = {
      ...loaded.pluginMetadata,
      ...(ctx.source.pluginMetadata ?? {}),
      marketplaceEntry: pluginEntry
    };

    if (loaded.sourceMetadata?.commitSha) {
      (ctx.source as any)._commitSha = loaded.sourceMetadata.commitSha;
    }

    if (loaded.sourceMetadata?.baseDetection) {
      applyBaseDetection(ctx, loaded);
    }

    const basePath = ctx.detectedBase || loaded.contentRoot || execContext.targetDir;
    const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot || basePath;
    
    return await installPluginPartial(basePath, pluginEntry, ctx, repoRoot);
  }
  
  // Full install: run unified pipeline
  logger.info('Using full install mode for git plugin', {
    plugin: pluginEntry.name
  });

  const installSpinner = output.spinner();
  installSpinner.start(`Installing ${pluginEntry.name}`);

  const pipelineResult = await runUnifiedInstallPipeline(ctx);
  
  // Get the actual generated name from the loaded package
  const installedName = ctx.source.packageName || pluginEntry.name;
  
  installSpinner.stop();
  
  if (pipelineResult.success) {
    output.success(installedName);
  } else {
    output.error(`${installedName}: ${pipelineResult.error || 'Unknown error'}`);
  }
  
  return {
    success: pipelineResult.success,
    error: pipelineResult.error
  };
}

/**
 * Validate that requested plugin names exist in marketplace.
 *
 * @param marketplace - Parsed marketplace manifest
 * @param requestedPlugins - Array of plugin names to validate
 * @returns Object with valid and invalid plugin name arrays
 */
export function validatePluginNames(
  marketplace: MarketplaceManifest,
  requestedPlugins: string[]
): { valid: string[]; invalid: string[] } {
  const availableNames = new Set(marketplace.plugins.map(p => p.name));

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const name of requestedPlugins) {
    if (availableNames.has(name)) {
      valid.push(name);
    } else {
      invalid.push(name);
    }
  }

  return { valid, invalid };
}

/**
 * Resolved plugin info for resource discovery (used by --list).
 */
export interface ResolvedPluginInfo {
  pluginEntry: MarketplacePluginEntry;
  context: InstallationContext;
  basePath: string;
  repoRoot: string;
}

/**
 * Resolve plugin content roots for resource discovery.
 * Loads each plugin's source and returns resolved paths and contexts
 * without installing anything.
 *
 * @param marketplaceDir - Absolute path to cloned marketplace repository root
 * @param marketplace - Parsed marketplace manifest
 * @param pluginNames - Plugin names to resolve
 * @param marketplaceGitUrl - Git URL of the marketplace repository
 * @param marketplaceGitRef - Git ref (branch/tag/sha) if specified
 * @param marketplaceCommitSha - Commit SHA of cached marketplace
 * @param options - Install options
 * @param execContext - Execution context
 * @returns Array of resolved plugin info objects
 */
export async function resolvePluginContentRoots(
  marketplaceDir: string,
  marketplace: MarketplaceManifest,
  pluginNames: string[],
  marketplaceGitUrl: string,
  marketplaceGitRef: string | undefined,
  marketplaceCommitSha: string,
  options: InstallOptions,
  execContext: ExecutionContext
): Promise<ResolvedPluginInfo[]> {
  const results: ResolvedPluginInfo[] = [];

  for (const name of pluginNames) {
    const pluginEntry = marketplace.plugins.find(p => p.name === name);
    if (!pluginEntry) continue;

    let normalizedSource: NormalizedPluginSource;
    try {
      normalizedSource = normalizePluginSource(pluginEntry.source, name);
    } catch (error) {
      logger.warn('Failed to normalize plugin source for list', { plugin: name, error });
      continue;
    }

    try {
      if (isRelativePathSource(normalizedSource)) {
        const pluginSubdir = normalizedSource.relativePath!;
        const pluginDir = join(marketplaceDir, pluginSubdir);

        if (!(await exists(pluginDir))) {
          logger.warn('Plugin path not found for list', { plugin: name, path: pluginSubdir });
          continue;
        }

        const ctx = await buildPathInstallContext(execContext, pluginDir, {
          ...options,
          sourceType: 'directory' as const
        });

        ctx.source.gitSourceOverride = {
          gitUrl: marketplaceGitUrl,
          gitRef: marketplaceGitRef,
          gitPath: pluginSubdir
        };

        ctx.source.pluginMetadata = {
          isPlugin: true,
          marketplaceEntry: pluginEntry,
          marketplaceSource: {
            url: marketplaceGitUrl,
            commitSha: marketplaceCommitSha,
            pluginName: pluginEntry.name
          }
        };

        ctx.detectedBase = pluginDir;
        ctx.baseRelative = relative(marketplaceDir, pluginDir) || '.';

        results.push({
          pluginEntry,
          context: ctx,
          basePath: pluginDir,
          repoRoot: marketplaceDir
        });
      } else if (isGitSource(normalizedSource)) {
        const ctx = await buildGitInstallContext(execContext, normalizedSource.gitUrl!, {
          ...options,
          gitRef: normalizedSource.gitRef,
          gitPath: normalizedSource.gitPath
        });

        ctx.source.pluginMetadata = {
          isPlugin: true,
          marketplaceEntry: pluginEntry
        };

        const loader = getLoaderForSource(ctx.source);
        const loaded = await loader.load(ctx.source, options, execContext);

        ctx.source.packageName = loaded.packageName;
        ctx.source.version = loaded.version;
        ctx.source.contentRoot = loaded.contentRoot;
        ctx.source.pluginMetadata = {
          ...loaded.pluginMetadata,
          ...(ctx.source.pluginMetadata ?? {}),
          marketplaceEntry: pluginEntry
        };

        if (loaded.sourceMetadata?.baseDetection) {
          applyBaseDetection(ctx, loaded);
        }

        const basePath = ctx.detectedBase || loaded.contentRoot || execContext.targetDir;
        const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot || basePath;

        results.push({
          pluginEntry,
          context: ctx,
          basePath,
          repoRoot
        });
      }
    } catch (error) {
      logger.warn('Failed to resolve plugin for list', { plugin: name, error });
      continue;
    }
  }

  return results;
}
