import { join } from 'path';
import { exists, readTextFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { DIR_PATTERNS, FILE_PATTERNS } from '../../constants/index.js';

export type PluginType = 'individual' | 'marketplace';

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
