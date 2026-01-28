import { join, basename } from 'path';
import { readTextFile, exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { ValidationError, UserCancellationError } from '../../utils/errors.js';
import { buildGitInstallContext } from './unified/context-builders.js';
import { runUnifiedInstallPipeline } from './unified/pipeline.js';
import { detectPluginType, validatePluginManifest } from './plugin-detector.js';
import { safePrompts } from '../../utils/prompts.js';
import { Spinner } from '../../utils/spinner.js';
import type { CommandResult, InstallOptions } from '../../types/index.js';
import { CLAUDE_PLUGIN_PATHS } from '../../constants/index.js';
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
 * Display interactive plugin selection prompt.
 * 
 * @param marketplace - Parsed marketplace manifest
 * @returns Array of selected plugin names (empty if user cancelled)
 */
export async function promptPluginSelection(
  marketplace: MarketplaceManifest
): Promise<string[]> {
  console.log(`✓ Marketplace: ${marketplace.name}`);
  if (marketplace.description) {
    console.log(`  ${marketplace.description}`);
  }
  console.log(`${marketplace.plugins.length} plugin${marketplace.plugins.length === 1 ? '' : 's'} available:`);

  const choices = marketplace.plugins
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(plugin => ({
      title: plugin.name,
      value: plugin.name,
      description: plugin.description || '',
      selected: false
    }));
  
  try {
    const response = await safePrompts({
      type: 'multiselect',
      name: 'plugins',
      message: 'Select plugins to install (space to select, enter to confirm):',
      choices,
      min: 1,
      hint: '- Use arrow keys to navigate, space to select/deselect, enter to confirm'
    });
    
    if (!response.plugins || response.plugins.length === 0) {
      logger.info('User cancelled plugin selection');
      return [];
    }
    
    logger.info('User selected plugins', { selected: response.plugins });
    return response.plugins as string[];
  } catch (error) {
    if (error instanceof UserCancellationError) {
      logger.info('User cancelled plugin selection');
      return [];
    }
    throw error;
  }
}

/**
 * Install selected plugins from a marketplace.
 * 
 * @param marketplaceDir - Absolute path to cloned marketplace repository root
 * @param marketplace - Parsed marketplace manifest
 * @param selectedNames - Names of plugins to install
 * @param marketplaceGitUrl - Git URL of the marketplace repository
 * @param marketplaceGitRef - Git ref (branch/tag/sha) if specified
 * @param marketplaceCommitSha - Commit SHA of cached marketplace
 * @param options - Install options
 * @param cwd - Current working directory for installation
 */
export async function installMarketplacePlugins(
  marketplaceDir: string,
  marketplace: MarketplaceManifest,
  selectedNames: string[],
  marketplaceGitUrl: string,
  marketplaceGitRef: string | undefined,
  marketplaceCommitSha: string,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  logger.info('Installing marketplace plugins', { 
    marketplace: marketplace.name,
    plugins: selectedNames 
  });
  
  console.log(`Installing ${selectedNames.length} plugin${selectedNames.length === 1 ? '' : 's'}...`);
  
  const results: Array<{ 
    name: string; 
    scopedName: string; 
    success: boolean; 
    error?: string;
  }> = [];
  
  for (const pluginName of selectedNames) {
    const pluginEntry = marketplace.plugins.find(p => p.name === pluginName);
    if (!pluginEntry) {
      logger.error(`Plugin '${pluginName}' not found in marketplace`, { 
        marketplace: marketplace.name 
      });
      results.push({ 
        name: pluginName,
        scopedName: pluginName,
        success: false, 
        error: `Plugin not found in marketplace` 
      });
      continue;
    }
    
    // Normalize the plugin source
    let normalizedSource: NormalizedPluginSource;
    try {
      normalizedSource = normalizePluginSource(pluginEntry.source, pluginName);
    } catch (error) {
      logger.error('Failed to normalize plugin source', { plugin: pluginName, error });
      results.push({ 
        name: pluginName,
        scopedName: pluginName,
        success: false, 
        error: error instanceof Error ? error.message : 'Invalid source configuration'
      });
      continue;
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
          marketplaceGitUrl,
          marketplaceGitRef,
          marketplaceCommitSha,
          options,
          cwd
        );
      } else if (isGitSource(normalizedSource)) {
        installResult = await installGitPlugin(
          marketplace,
          pluginEntry,
          normalizedSource,
          options,
          cwd
        );
      } else {
        throw new Error(`Unsupported source type: ${normalizedSource.type}`);
      }
      
      if (!installResult.success) {
        results.push({
          name: pluginName,
          scopedName: pluginEntry.name,
          success: false,
          error: installResult.error || 'Unknown installation error'
        });
        continue;
      }
      
      results.push({ 
        name: pluginName, 
        scopedName: pluginEntry.name, 
        success: true 
      });
      
    } catch (error) {
      logger.error('Failed to install plugin', { plugin: pluginName, error });
      results.push({ 
        name: pluginName,
        scopedName: pluginEntry.name,
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
  
  // Display summary
  displayInstallationSummary(results);
  
  // Return success if at least one plugin was installed
  return {
    success: results.some(r => r.success),
    error: results.every(r => !r.success) 
      ? 'Failed to install any plugins from marketplace'
      : undefined
  };
}

/**
 * Install a plugin from a relative path within the marketplace repository.
 */
async function installRelativePathPlugin(
  marketplaceDir: string,
  marketplace: MarketplaceManifest,
  pluginEntry: MarketplacePluginEntry,
  normalizedSource: NormalizedPluginSource,
  marketplaceGitUrl: string,
  marketplaceGitRef: string | undefined,
  marketplaceCommitSha: string,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const pluginSubdir = normalizedSource.relativePath!;
  const pluginDir = join(marketplaceDir, pluginSubdir);
  
  const spinner = new Spinner(`Validating ${pluginEntry.name}`);
  spinner.start();
  
  // Validate plugin subdirectory exists
  if (!(await exists(pluginDir))) {
    const error = `Path '${pluginSubdir}' does not exist in marketplace repository`;
    logger.error('Plugin path not found', { 
      plugin: pluginEntry.name, 
      path: pluginSubdir,
      fullPath: pluginDir
    });
    spinner.stop();
    console.error(`❌ ${pluginEntry.name}: ${error}`);
    return { success: false, error };
  }
  
  // Validate plugin structure with marketplace context
  const { detectPluginWithMarketplace } = await import('./plugin-detector.js');
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
    spinner.stop();
    console.error(`❌ ${pluginEntry.name}: ${error}`);
    return { success: false, error };
  }
  
  // For plugins with plugin.json, validate it's parseable
  if (detection.manifestPath) {
    if (!(await validatePluginManifest(detection.manifestPath))) {
      const error = `Invalid plugin manifest in '${pluginSubdir}' (cannot parse JSON)`;
      logger.error('Invalid plugin manifest', { plugin: pluginEntry.name });
      spinner.stop();
      console.error(`❌ ${pluginEntry.name}: ${error}`);
      return { success: false, error };
    }
  }
  
  spinner.update(`✓ Installing ${pluginEntry.name}`);
  logger.info('Installing relative path plugin', {
    plugin: pluginEntry.name,
    path: pluginSubdir
  });
  
  // Build path context for the already-cloned plugin directory
  // Use path-based loading (efficient, no re-clone) with git source override for manifest
  const { buildPathInstallContext } = await import('./unified/context-builders.js');
  const ctx = await buildPathInstallContext(
    cwd,
    pluginDir,
    {
      ...options,
      sourceType: 'directory' as const
    }
  );
  
  // Add git source override for manifest recording
  // This ensures the plugin is recorded in openpackage.yml with git/subdirectory fields
  // even though we're loading from a path (already-cloned repo)
  ctx.source.gitSourceOverride = {
    gitUrl: marketplaceGitUrl,
    gitRef: marketplaceGitRef,
    gitPath: pluginSubdir
  };
  
  // Add marketplace metadata to context for passing to loader and workspace index
  // This will be used by the path source loader to pass marketplace entry
  // to plugin transformer for proper scoped naming
  ctx.source.pluginMetadata = {
    isPlugin: true,
    pluginType: detection.type as any,
    manifestPath: detection.manifestPath,
    marketplaceEntry: pluginEntry,
    marketplaceSource: {
      url: marketplaceGitUrl,
      commitSha: marketplaceCommitSha,
      pluginName: pluginEntry.name
    }
  };
  
  // Stop spinner before pipeline (which has its own output)
  spinner.stop();
  
  const pipelineResult = await runUnifiedInstallPipeline(ctx);
  
  // Get the actual generated name from the loaded package
  const installedName = ctx.source.packageName || pluginEntry.name;
  
  if (pipelineResult.success) {
    console.log(`✓ ${installedName}`);
  } else {
    console.error(`❌ ${installedName}: ${pipelineResult.error || 'Unknown error'}`);
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
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const gitUrl = normalizedSource.gitUrl!;
  const gitRef = normalizedSource.gitRef;
  const gitPath = normalizedSource.gitPath;
  
  const spinner = new Spinner(`Installing ${pluginEntry.name}`);
  spinner.start();
  
  logger.info('Installing git plugin', {
    plugin: pluginEntry.name,
    gitUrl,
    gitRef,
    gitPath
  });
  
  // Build git context
  const ctx = await buildGitInstallContext(
    cwd,
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
  
  // Stop spinner before pipeline (which has its own output)
  spinner.stop();
  
  const pipelineResult = await runUnifiedInstallPipeline(ctx);
  
  // Get the actual generated name from the loaded package
  const installedName = ctx.source.packageName || pluginEntry.name;
  
  if (pipelineResult.success) {
    console.log(`✓ ${installedName}`);
  } else {
    console.error(`❌ ${installedName}: ${pipelineResult.error || 'Unknown error'}`);
  }
  
  return {
    success: pipelineResult.success,
    error: pipelineResult.error
  };
}

/**
 * Load marketplace manifest from git cache.
 * The marketplace.json is part of the cloned repo content.
 * 
 * @param gitUrl - Git URL of marketplace repository
 * @param commitSha - Commit SHA of cached version
 * @returns Parsed marketplace manifest
 */
export async function loadMarketplaceFromCache(
  gitUrl: string,
  commitSha: string
): Promise<MarketplaceManifest> {
  const { getGitCommitCacheDir } = await import('../../utils/git-cache.js');
  
  const commitDir = getGitCommitCacheDir(gitUrl, commitSha);
  const manifestPath = join(commitDir, CLAUDE_PLUGIN_PATHS.MARKETPLACE_MANIFEST);
  
  if (!(await exists(manifestPath))) {
    throw new ValidationError(
      `Marketplace manifest not found in cache. ` +
      `Expected at: ${manifestPath}. ` +
      `The repository may need to be re-cloned.`
    );
  }
  
  logger.debug('Loading marketplace from cache', { gitUrl, commitSha, manifestPath });
  
  return await parseMarketplace(manifestPath, {
    gitUrl,
    repoPath: commitDir
  });
}

/**
 * Find a plugin entry in marketplace by name.
 * 
 * @param marketplace - Parsed marketplace manifest
 * @param pluginName - Plugin name to find
 * @returns Plugin entry or undefined if not found
 */
export function findPluginInMarketplace(
  marketplace: MarketplaceManifest,
  pluginName: string
): MarketplacePluginEntry | undefined {
  return marketplace.plugins.find(p => p.name === pluginName);
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
 * Display installation summary.
 */
function displayInstallationSummary(
  results: Array<{ name: string; scopedName: string; success: boolean; error?: string }>
): void {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    console.log(`✓ Successfully installed: ${successful.length} plugin${successful.length === 1 ? '' : 's'}`);
  }
  
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length} plugin${failed.length === 1 ? '' : 's'}`);
    for (const result of failed) {
      console.log(`  ${result.scopedName}: ${result.error}`);
    }
  }
}
