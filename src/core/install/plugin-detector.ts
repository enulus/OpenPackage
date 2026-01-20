import { join } from 'path';
import { promises as fs } from 'fs';
import { exists, readTextFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { DIR_PATTERNS, FILE_PATTERNS } from '../../constants/index.js';
import type { MarketplacePluginEntry } from './marketplace-handler.js';

export type PluginType = 'individual' | 'marketplace' | 'marketplace-defined';

export interface PluginDetectionResult {
  isPlugin: boolean;
  type?: PluginType;
  manifestPath?: string;
}

/**
 * Detect if a directory contains a Claude Code plugin.
 * 
 * Detection order:
 * 1. Check for .claude-plugin/plugin.json (individual plugin)
 * 2. Check for .claude-plugin/marketplace.json (marketplace)
 * 
 * @param dirPath - Absolute path to directory to check
 * @returns Detection result with plugin type if found
 */
export async function detectPluginType(dirPath: string): Promise<PluginDetectionResult> {
  logger.debug('Detecting plugin type', { dirPath });
  
  const pluginDir = join(dirPath, DIR_PATTERNS.CLAUDE_PLUGIN);
  
  // Check for individual plugin
  const pluginManifestPath = join(pluginDir, FILE_PATTERNS.PLUGIN_JSON);
  if (await exists(pluginManifestPath)) {
    logger.info('Detected individual Claude Code plugin', { path: pluginManifestPath });
    return {
      isPlugin: true,
      type: 'individual',
      manifestPath: pluginManifestPath
    };
  }
  
  // Check for marketplace
  const marketplaceManifestPath = join(pluginDir, FILE_PATTERNS.MARKETPLACE_JSON);
  if (await exists(marketplaceManifestPath)) {
    logger.info('Detected Claude Code plugin marketplace', { path: marketplaceManifestPath });
    return {
      isPlugin: true,
      type: 'marketplace',
      manifestPath: marketplaceManifestPath
    };
  }
  
  // Not a plugin
  return { isPlugin: false };
}

/**
 * Detect if a directory contains a Claude Code plugin, with marketplace context.
 * 
 * This enhanced detection supports marketplace-defined plugins (strict:false) that
 * may not have their own plugin.json file.
 * 
 * Detection order:
 * 1. Check for .claude-plugin/plugin.json (individual plugin)
 * 2. Check for .claude-plugin/marketplace.json (marketplace)
 * 3. If marketplaceEntry exists AND strict:false, check for plugin content
 * 
 * @param dirPath - Absolute path to directory to check
 * @param marketplaceEntry - Optional marketplace entry for this plugin
 * @returns Detection result with plugin type if found
 */
export async function detectPluginWithMarketplace(
  dirPath: string,
  marketplaceEntry?: MarketplacePluginEntry
): Promise<PluginDetectionResult> {
  // First try standard detection
  const standardDetection = await detectPluginType(dirPath);
  
  if (standardDetection.isPlugin) {
    return standardDetection;
  }
  
  // If no plugin.json and marketplace entry with strict:false, check for plugin content
  if (marketplaceEntry?.strict === false) {
    const hasContent = await hasPluginContent(dirPath);
    
    if (hasContent) {
      logger.info('Detected marketplace-defined plugin (strict:false)', { 
        dirPath,
        pluginName: marketplaceEntry.name 
      });
      
      return {
        isPlugin: true,
        type: 'marketplace-defined'
      };
    }
  }
  
  return { isPlugin: false };
}

/**
 * Check if a directory has plugin content (commands, agents, etc.)
 * Used to validate marketplace-defined plugins that don't have plugin.json.
 */
async function hasPluginContent(dirPath: string): Promise<boolean> {
  const pluginContentDirs = ['commands', 'agents', 'skills', 'hooks'];
  const pluginContentFiles = ['.mcp.json', '.lsp.json'];
  
  // Check for plugin content directories
  for (const subdir of pluginContentDirs) {
    const subdirPath = join(dirPath, subdir);
    if (await exists(subdirPath)) {
      // Check if directory is not empty
      try {
        const items = await fs.readdir(subdirPath);
        if (items.length > 0) {
          logger.debug('Found plugin content directory', { subdir, dirPath });
          return true;
        }
      } catch {
        // Ignore errors reading directory
      }
    }
  }
  
  // Check for plugin content files
  for (const file of pluginContentFiles) {
    const filePath = join(dirPath, file);
    if (await exists(filePath)) {
      logger.debug('Found plugin content file', { file, dirPath });
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a directory is an individual plugin.
 */
export async function isIndividualPlugin(dirPath: string): Promise<boolean> {
  const result = await detectPluginType(dirPath);
  return result.isPlugin && result.type === 'individual';
}

/**
 * Check if a directory is a marketplace.
 */
export async function isMarketplace(dirPath: string): Promise<boolean> {
  const result = await detectPluginType(dirPath);
  return result.isPlugin && result.type === 'marketplace';
}

/**
 * Validate that a plugin manifest can be parsed.
 * Returns true if the manifest is valid JSON.
 */
export async function validatePluginManifest(manifestPath: string): Promise<boolean> {
  try {
    const content = await readTextFile(manifestPath);
    JSON.parse(content);
    return true;
  } catch (error) {
    logger.error('Failed to parse plugin manifest', { manifestPath, error });
    return false;
  }
}
