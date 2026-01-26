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
  repoPath?: string;            // Path to repository root (for fallback)
}

/**
 * Generate a scoped name for a Claude Code plugin.
 * 
 * Format:
 * - GitHub repo with subdirectory: gh@username/repo/p/plugin-name
 * - GitHub repo (plugin is the repo): gh@username/repo
 * - Non-GitHub or local: plugin-name (no scoping)
 * 
 * Fallback behavior:
 * - If pluginManifestName is undefined → use subdirectory name or repo name
 */
export function generatePluginName(
  context: PluginNamingContext
): string {
  const {
    gitUrl,
    subdirectory,
    pluginManifestName,
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
  
  // GitHub URL - generate scoped name using repo name
  const { username, repo } = githubInfo;
  
  // Determine if this is a marketplace plugin (has subdirectory)
  const isMarketplacePlugin = Boolean(subdirectory);
  
  if (isMarketplacePlugin) {
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
    
    // Format: gh@username/repo/p/plugin-name
    const plugin = pluginName.toLowerCase();
    const generated = `gh@${username}/${repo}/p/${plugin}`;
    return generated;
  } else {
    // Format: gh@username/repo
    const generated = `gh@${username}/${repo}`;
    return generated;
  }
}

/**
 * Generate a scoped name for a marketplace.
 * 
 * Format:
 * - GitHub: gh@username/repo
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
  
  // GitHub URL - generate scoped name using repo name
  const { username, repo } = githubInfo;
  
  return `gh@${username}/${repo}`;
}

/**
 * Parse a scoped plugin name into its components.
 * Supports new (gh@username/repo/p/plugin), new standalone (gh@username/repo),
 * legacy (gh@username/repo/plugin), and old (@username/...) formats.
 * Returns null if the name is not scoped.
 */
export function parseScopedPluginName(name: string): {
  username: string;
  repo: string;
  plugin?: string;
  isGitHub: boolean;
} | null {
  // New GitHub format: gh@username/repo or gh@username/repo/...
  const ghMatch = name.match(/^gh@([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
  if (ghMatch) {
    const [, username, repo, rest] = ghMatch;
    
    // Check if it has /p/ prefix (new format with plugin)
    if (rest?.startsWith('p/')) {
      return {
        username,
        repo,
        plugin: rest.substring(2), // Remove 'p/' prefix
        isGitHub: true
      };
    }
    
    // Legacy format: gh@username/repo/plugin (no /p/ prefix)
    if (rest) {
      return {
        username,
        repo,
        plugin: rest,
        isGitHub: true
      };
    }
    
    // Standalone repo: gh@username/repo
    return {
      username,
      repo,
      plugin: undefined,
      isGitHub: true
    };
  }
  
  // Old format with plugin: @username/repo/plugin
  const oldPluginMatch = name.match(/^@([^\/]+)\/([^\/]+)\/(.+)$/);
  if (oldPluginMatch) {
    const [, username, repo, plugin] = oldPluginMatch;
    return {
      username,
      repo,
      plugin,
      isGitHub: false
    };
  }
  
  // Old format standalone: @username/repo
  const oldRepoMatch = name.match(/^@([^\/]+)\/([^\/]+)$/);
  if (oldRepoMatch) {
    const [, username, repo] = oldRepoMatch;
    return {
      username,
      repo,
      plugin: undefined,
      isGitHub: false
    };
  }
  
  return null;
}

/**
 * Check if a name is a scoped plugin name (either new gh@ format or old @ format).
 */
export function isScopedPluginName(name: string): boolean {
  return parseScopedPluginName(name) !== null;
}

/**
 * Check if a name uses the new GitHub format (gh@username/...).
 */
export function isGitHubPluginName(name: string): boolean {
  return name.startsWith('gh@');
}

/**
 * Detect if a plugin dependency uses old naming format.
 * Returns the correct new name if migration needed, null otherwise.
 * 
 * Old format: @username/marketplace-name/plugin (marketplace name from marketplace.json)
 * New format: @username/repo/plugin (always use repo name)
 */
export function detectOldPluginNaming(dep: { name: string; git?: string; subdirectory?: string }): string | null {
  // Only check GitHub git sources with scoped names
  if (!dep.git || !dep.name.startsWith('@')) {
    return null;
  }
  
  const githubInfo = extractGitHubInfo(dep.git);
  if (!githubInfo) {
    return null;
  }
  
  const { username, repo } = githubInfo;
  
  // Parse the current name
  const nameMatch = dep.name.match(/^@([^\/]+)\/(?:([^\/]+)\/)?([^\/]+)$/);
  if (!nameMatch) {
    return null;
  }
  
  const [, nameUsername, middlePart, pluginPart] = nameMatch;
  
  // Check if username matches
  if (nameUsername !== username) {
    return null;
  }
  
  // If there's a subdirectory, this should be a 3-part name
  if (dep.subdirectory) {
    // Expected format: @username/repo/plugin
    const expectedName = `@${username}/${repo}/${pluginPart}`;
    
    // If middle part doesn't match repo name, it's old format
    if (middlePart !== repo) {
      return expectedName;
    }
  } else {
    // No subdirectory - should be 2-part name: @username/repo
    const expectedName = `@${username}/${repo}`;
    
    // If current name has 3 parts or doesn't match repo, it's old format
    if (middlePart || nameUsername + '/' + (middlePart || pluginPart) !== username + '/' + repo) {
      return expectedName;
    }
  }
  
  return null;
}

/**
 * Detect if a plugin dependency uses old GitHub naming format without gh@ prefix.
 * Returns the correct new name if migration needed, null otherwise.
 * 
 * Old format: @username/repo or @username/repo/plugin
 * New format: gh@username/repo or gh@username/repo/p/plugin
 */
export function detectOldGitHubNaming(dep: { name: string; git?: string; subdirectory?: string }): string | null {
  // Skip if already using new format
  if (dep.name.startsWith('gh@')) {
    return null;
  }
  
  // Only check GitHub git sources with @ prefix (but not gh@)
  if (!dep.git || !dep.name.startsWith('@')) {
    return null;
  }
  
  const githubInfo = extractGitHubInfo(dep.git);
  if (!githubInfo) {
    return null;
  }
  
  const { username, repo } = githubInfo;
  
  // Check if old format has plugin segment: @username/repo/plugin
  const oldPluginMatch = dep.name.match(/^@([^\/]+)\/([^\/]+)\/(.+)$/);
  if (oldPluginMatch) {
    const [, , , pluginPath] = oldPluginMatch;
    // Convert to new format with /p/ infix
    return `gh@${username}/${repo}/p/${pluginPath}`;
  }
  
  // Check if old format is standalone: @username/repo
  const oldRepoMatch = dep.name.match(/^@([^\/]+)\/([^\/]+)$/);
  if (oldRepoMatch) {
    // Convert to new format without /p/
    return `gh@${username}/${repo}`;
  }
  
  return null;
}
