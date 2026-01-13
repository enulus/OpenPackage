import { basename } from 'path';
import { extractGitHubInfo } from './git-url-parser.js';
import { logger } from './logger.js';

/**
 * Context for generating scoped plugin names.
 */
export interface PluginNamingContext {
  gitUrl?: string;              // Git URL (for extracting GitHub info)
  subdirectory?: string;        // Subdirectory within repo
  pluginManifestName?: string;  // Name from plugin.json (may be undefined)
  marketplaceName?: string;     // Name from marketplace.json (may be undefined)
  repoPath?: string;            // Path to repository root (for fallback)
}

/**
 * Generate a scoped name for a Claude Code plugin.
 * 
 * Format:
 * - GitHub repo with subdirectory: @username/repo/plugin-name
 * - GitHub repo (plugin is the repo): @username/plugin-name
 * - Non-GitHub or local: plugin-name (no scoping)
 * 
 * Fallback behavior:
 * - If pluginManifestName is undefined → use subdirectory name or repo name
 * - If marketplaceName is undefined → use repo name
 */
export function generatePluginName(
  context: PluginNamingContext
): string {
  const {
    gitUrl,
    subdirectory,
    pluginManifestName,
    marketplaceName,
    repoPath
  } = context;
  
  // If no Git URL, use plugin manifest name or fallback
  if (!gitUrl) {
    const generated =
      pluginManifestName || (subdirectory ? basename(subdirectory) : 'unnamed-plugin');
    return generated;
  }
  
  // Try to extract GitHub info
  const githubInfo = extractGitHubInfo(gitUrl);
  
  // If not GitHub, use plugin manifest name
  if (!githubInfo) {
    logger.debug('Non-GitHub URL, using plugin manifest name', { gitUrl });
    const generated =
      pluginManifestName || (subdirectory ? basename(subdirectory) : 'unnamed-plugin');
    return generated;
  }
  
  // GitHub URL - generate scoped name
  const { username, repo } = githubInfo;
  
  // Determine plugin name
  let pluginName: string;
  
  if (pluginManifestName) {
    // Use plugin manifest name if provided
    pluginName = pluginManifestName;
  } else if (subdirectory) {
    // Use subdirectory name as fallback
    pluginName = basename(subdirectory);
  } else {
    // Use repo name as fallback
    pluginName = repo;
  }
  
  // Determine if this is a marketplace plugin (has subdirectory)
  const isMarketplacePlugin = Boolean(subdirectory);
  
  if (isMarketplacePlugin) {
    // Format (marketplace plugin): @username/marketplace/plugin
    // This matches how Claude Code marketplaces identify plugins.
    const marketplace = (marketplaceName || repo).toLowerCase();
    const plugin = pluginName.toLowerCase();
    const generated = `@${username}/${marketplace}/${plugin}`;
    return generated;
  } else {
    // Format: @username/plugin-name
    const generated = `@${username}/${pluginName}`;
    return generated;
  }
}

/**
 * Generate a scoped name for a marketplace.
 * 
 * Format:
 * - GitHub: @username/marketplace-name
 * - Non-GitHub: marketplace-name
 */
export function generateMarketplaceName(
  gitUrl: string | undefined,
  marketplaceManifestName?: string,
  repoPath?: string
): string {
  // If no Git URL, use marketplace manifest name or fallback
  if (!gitUrl) {
    return marketplaceManifestName || 
           (repoPath ? basename(repoPath) : 'unnamed-marketplace');
  }
  
  // Try to extract GitHub info
  const githubInfo = extractGitHubInfo(gitUrl);
  
  // If not GitHub, use marketplace manifest name
  if (!githubInfo) {
    return marketplaceManifestName || 
           (repoPath ? basename(repoPath) : 'unnamed-marketplace');
  }
  
  // GitHub URL - generate scoped name
  const { username, repo } = githubInfo;
  const marketplaceName = marketplaceManifestName || repo;
  
  return `@${username}/${marketplaceName}`;
}

/**
 * Parse a scoped plugin name into its components.
 * Returns null if the name is not scoped.
 */
export function parseScopedPluginName(name: string): {
  username: string;
  marketplace?: string;
  plugin: string;
} | null {
  // Format: @username/marketplace/plugin or @username/plugin
  const match = name.match(/^@([^\/]+)\/(?:([^\/]+)\/)?([^\/]+)$/);
  
  if (!match) {
    return null;
  }
  
  const [, username, marketplace, plugin] = match;
  
  return {
    username,
    marketplace,
    plugin
  };
}

/**
 * Check if a name is a scoped plugin name.
 */
export function isScopedPluginName(name: string): boolean {
  return parseScopedPluginName(name) !== null;
}
