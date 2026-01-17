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
import { generatePluginName } from '../../utils/plugin-naming.js';
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
 */
export interface MarketplacePluginEntry {
  name: string;
  source: PluginSourceSpec;
  description?: string;
  version?: string;
  author?: {
    name?: string;
    email?: string;
  };
  keywords?: string[];
  category?: string;
  strict?: boolean;
  // Additional plugin manifest fields can be included here
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
  console.log(`\n✓ Marketplace: ${marketplace.name}`);
  if (marketplace.description) {
    console.log(`  ${marketplace.description}`);
  }
  console.log(`\n${marketplace.plugins.length} plugin${marketplace.plugins.length === 1 ? '' : 's'} available:\n`);
  
  const choices = marketplace.plugins.map(plugin => ({
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
 * @param options - Install options
 * @param cwd - Current working directory for installation
 */
export async function installMarketplacePlugins(
  marketplaceDir: string,
  marketplace: MarketplaceManifest,
  selectedNames: string[],
  marketplaceGitUrl: string,
  marketplaceGitRef: string | undefined,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  logger.info('Installing marketplace plugins', { 
    marketplace: marketplace.name,
    plugins: selectedNames 
  });
  
  console.log(`\nInstalling ${selectedNames.length} plugin${selectedNames.length === 1 ? '' : 's'}...\n`);
  
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
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const pluginSubdir = normalizedSource.relativePath!;
  const pluginDir = join(marketplaceDir, pluginSubdir);
  
  const spinner = new Spinner(`Validating ${pluginEntry.name}`);
  spinner.start();
  
  // Validate plugin subdirectory exists
  if (!(await exists(pluginDir))) {
    const error = `Subdirectory '${pluginSubdir}' does not exist in marketplace repository`;
    logger.error('Plugin subdirectory not found', { 
      plugin: pluginEntry.name, 
      subdirectory: pluginSubdir,
      fullPath: pluginDir
    });
    spinner.stop();
    console.error(`❌ ${pluginEntry.name}: ${error}`);
    return { success: false, error };
  }
  
  // Validate plugin structure
  const detection = await detectPluginType(pluginDir);
  if (!detection.isPlugin || detection.type !== 'individual') {
    const error = `Subdirectory '${pluginSubdir}' does not contain a valid plugin ` +
      `(missing ${CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST})`;
    logger.error('Invalid plugin structure', { 
      plugin: pluginEntry.name, 
      subdirectory: pluginSubdir 
    });
    spinner.stop();
    console.error(`❌ ${pluginEntry.name}: ${error}`);
    return { success: false, error };
  }
  
  // Validate plugin manifest is parseable
  if (!(await validatePluginManifest(detection.manifestPath!))) {
    const error = `Invalid plugin manifest in '${pluginSubdir}' (cannot parse JSON)`;
    logger.error('Invalid plugin manifest', { plugin: pluginEntry.name });
    spinner.stop();
    console.error(`❌ ${pluginEntry.name}: ${error}`);
    return { success: false, error };
  }
  
  // Generate scoped name
  const scopedName = generatePluginName({
    gitUrl: marketplaceGitUrl,
    subdirectory: pluginSubdir,
    pluginManifestName: pluginEntry.name,
    marketplaceName: marketplace.name,
    repoPath: marketplaceDir
  });
  
  spinner.update(`✓ Installing ${scopedName}`);
  logger.info('Installing relative path plugin', {
    plugin: pluginEntry.name,
    scopedName,
    subdirectory: pluginSubdir
  });
  
  // Build git context with subdirectory to properly track git source
  const ctx = await buildGitInstallContext(
    cwd,
    marketplaceGitUrl,
    {
      ...options,
      gitRef: marketplaceGitRef,
      gitSubdirectory: pluginSubdir
    }
  );
  
  // Stop spinner before pipeline (which has its own output)
  spinner.stop();
  
  const pipelineResult = await runUnifiedInstallPipeline(ctx);
  
  if (pipelineResult.success) {
    console.log(`✓ ${scopedName}`);
  } else {
    console.error(`❌ ${scopedName}: ${pipelineResult.error || 'Unknown error'}`);
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
  const gitSubdirectory = normalizedSource.gitSubdirectory;
  
  // Generate scoped name
  const scopedName = generatePluginName({
    gitUrl,
    subdirectory: gitSubdirectory,
    pluginManifestName: pluginEntry.name,
    marketplaceName: marketplace.name
  });
  
  const spinner = new Spinner(`Installing ${scopedName}`);
  spinner.start();
  
  logger.info('Installing git plugin', {
    plugin: pluginEntry.name,
    scopedName,
    gitUrl,
    gitRef,
    gitSubdirectory
  });
  
  // Build git context
  const ctx = await buildGitInstallContext(
    cwd,
    gitUrl,
    {
      ...options,
      gitRef,
      gitSubdirectory
    }
  );
  
  // Stop spinner before pipeline (which has its own output)
  spinner.stop();
  
  const pipelineResult = await runUnifiedInstallPipeline(ctx);
  
  if (pipelineResult.success) {
    console.log(`✓ ${scopedName}`);
  } else {
    console.error(`❌ ${scopedName}: ${pipelineResult.error || 'Unknown error'}`);
  }
  
  return {
    success: pipelineResult.success,
    error: pipelineResult.error
  };
}

/**
 * Display installation summary.
 */
function displayInstallationSummary(
  results: Array<{ name: string; scopedName: string; success: boolean; error?: string }>
): void {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n${'─'.repeat(60)}`);
  
  if (successful.length > 0) {
    console.log(`✓ Successfully installed: ${successful.length} plugin${successful.length === 1 ? '' : 's'}`);
  }
  
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length} plugin${failed.length === 1 ? '' : 's'}`);
    for (const result of failed) {
      console.log(`  ${result.scopedName}: ${result.error}`);
    }
  }
  
  console.log(`${'─'.repeat(60)}\n`);
}
