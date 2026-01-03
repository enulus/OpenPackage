import { join } from 'path';
import { readTextFile, exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { runPathInstallPipeline, type PathInstallPipelineOptions } from './path-install-pipeline.js';
import { detectPluginType, validatePluginManifest } from './plugin-detector.js';
import prompts from 'prompts';
import type { CommandResult } from '../../types/index.js';

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

export interface MarketplacePluginEntry {
  name: string;
  subdirectory?: string; // opkg format
  source?: string; // Claude Code format (relative path)
  description?: string;
  version?: string;
  author?: {
    name?: string;
  };
  keywords?: string[];
  category?: string;
}

/**
 * Parse and validate a marketplace manifest.
 * 
 * @param manifestPath - Path to marketplace.json file
 * @returns Parsed marketplace manifest
 */
export async function parseMarketplace(manifestPath: string): Promise<MarketplaceManifest> {
  logger.debug('Parsing marketplace manifest', { manifestPath });
  
  try {
    const content = await readTextFile(manifestPath);
    const manifest = JSON.parse(content) as MarketplaceManifest;
    
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
      // Accept either subdirectory (opkg) or source (Claude Code) field
      if (!plugin.subdirectory && !plugin.source) {
        throw new ValidationError(`Plugin '${plugin.name}' missing required field: subdirectory or source`);
      }
      // Normalize: if source is provided but not subdirectory, use source as subdirectory
      if (!plugin.subdirectory && plugin.source) {
        plugin.subdirectory = plugin.source;
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
  console.log(`\n📦 Marketplace: ${marketplace.name}`);
  if (marketplace.description) {
    console.log(`   ${marketplace.description}`);
  }
  console.log(`\n${marketplace.plugins.length} plugin${marketplace.plugins.length === 1 ? '' : 's'} available:\n`);
  
  const choices = marketplace.plugins.map(plugin => ({
    title: plugin.name,
    value: plugin.name,
    description: plugin.description || '',
    selected: false
  }));
  
  const response = await prompts({
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
}

/**
 * Install selected plugins from a marketplace.
 * 
 * @param marketplaceDir - Absolute path to cloned marketplace repository root
 * @param marketplace - Parsed marketplace manifest
 * @param selectedNames - Names of plugins to install
 * @param gitUrl - Git URL of the marketplace repository
 * @param gitRef - Git ref (branch/tag/sha) if specified
 * @param options - Install options
 */
export async function installMarketplacePlugins(
  marketplaceDir: string,
  marketplace: MarketplaceManifest,
  selectedNames: string[],
  gitUrl: string,
  gitRef: string | undefined,
  options: Omit<PathInstallPipelineOptions, 'sourcePath' | 'sourceType' | 'targetDir' | 'gitUrl' | 'gitRef' | 'gitSubdirectory'>
): Promise<CommandResult> {
  logger.info('Installing marketplace plugins', { 
    marketplace: marketplace.name,
    plugins: selectedNames 
  });
  
  const results: Array<{ name: string; success: boolean; error?: string }> = [];
  
  for (const pluginName of selectedNames) {
    const pluginEntry = marketplace.plugins.find(p => p.name === pluginName);
    if (!pluginEntry) {
      logger.error(`Plugin '${pluginName}' not found in marketplace`, { marketplace: marketplace.name });
      results.push({ 
        name: pluginName, 
        success: false, 
        error: `Plugin not found in marketplace` 
      });
      continue;
    }
    
    const pluginSubdir = pluginEntry.subdirectory || pluginEntry.source;
    if (!pluginSubdir) {
      logger.error(`Plugin entry missing both subdirectory and source fields`, { plugin: pluginName });
      results.push({ 
        name: pluginName, 
        success: false, 
        error: `Plugin entry missing subdirectory/source field` 
      });
      continue;
    }
    
    const pluginDir = join(marketplaceDir, pluginSubdir);
    
    // Validate plugin subdirectory exists
    if (!(await exists(pluginDir))) {
      logger.error(`Plugin subdirectory does not exist`, { 
        plugin: pluginName, 
        subdirectory: pluginSubdir,
        fullPath: pluginDir
      });
      results.push({ 
        name: pluginName, 
        success: false, 
        error: `Subdirectory '${pluginSubdir}' does not exist` 
      });
      continue;
    }
    
    // Validate plugin structure
    const detection = await detectPluginType(pluginDir);
    if (!detection.isPlugin || detection.type !== 'individual') {
      logger.error(`Subdirectory is not a valid plugin`, { 
        plugin: pluginName, 
        subdirectory: pluginSubdir 
      });
      results.push({ 
        name: pluginName, 
        success: false, 
        error: `Subdirectory does not contain a valid plugin (missing .claude-plugin/plugin.json)` 
      });
      continue;
    }
    
    // Validate plugin manifest is parseable
    if (!(await validatePluginManifest(detection.manifestPath!))) {
      results.push({ 
        name: pluginName, 
        success: false, 
        error: `Invalid plugin manifest (cannot parse JSON)` 
      });
      continue;
    }
    
    // Install the plugin
    console.log(`\n📦 Installing plugin: ${pluginName}...`);
    
    try {
      await runPathInstallPipeline({
        ...options,
        sourcePath: pluginDir,
        sourceType: 'directory',
        targetDir: '.',
        gitUrl,
        gitRef,
        gitSubdirectory: pluginSubdir
      });
      
      results.push({ name: pluginName, success: true });
      console.log(`✓ Successfully installed ${pluginName}`);
      
    } catch (error) {
      logger.error(`Failed to install plugin`, { plugin: pluginName, error });
      results.push({ 
        name: pluginName, 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      });
      console.error(`✗ Failed to install ${pluginName}: ${error}`);
    }
  }
  
  // Display summary
  console.log('\n' + '='.repeat(60));
  console.log('Installation Summary:');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    console.log(`\n✓ Successfully installed (${successful.length}):`);
    for (const result of successful) {
      console.log(`  • ${result.name}`);
    }
  }
  
  if (failed.length > 0) {
    console.log(`\n✗ Failed to install (${failed.length}):`);
    for (const result of failed) {
      console.log(`  • ${result.name}: ${result.error}`);
    }
  }
  
  console.log('');
  
  // Return success if at least one plugin was installed
  if (successful.length > 0) {
    return {
      success: true
    };
  } else {
    return {
      success: false,
      error: 'Failed to install any plugins from marketplace'
    };
  }
}
