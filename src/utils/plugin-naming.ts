import { basename } from 'path';
import { extractGitHubInfo } from './git-url-parser.js';
import { logger } from './logger.js';

/**
 * Context for generating scoped package names from GitHub sources.
 * Used for both Claude plugins and OpenPackage repositories.
 */
export interface GitHubPackageNamingContext {
  /** Git URL (for extracting GitHub info) */
  gitUrl?: string;
  
  /**
   * Path within repository (relative to repo root)
   * 
   * IMPORTANT: For skills, this MUST include the full path including
   * the skill subdirectory. Example: "plugins/ui-design/skills/mobile-ios-design"
   * 
   * Do NOT append skillMetadata.skillPath to this value.
   */
  path?: string;
  
  /** Name from manifest (plugin.json or openpackage.yml) */
  packageName?: string;
  
  /** Path to repository root (for fallback) */
  repoPath?: string;
}

/**
 * Generate a scoped name for any GitHub-sourced package.
 * 
 * Works for:
 * - Claude Code plugins
 * - OpenPackage repositories
 * - Marketplace plugins
 * 
 * Format:
 * - GitHub repo with path: gh@username/repo/path
 * - GitHub repo (package is the repo): gh@username/repo
 * - Non-GitHub or local: use packageName as-is (no scoping)
 * 
 * Fallback behavior:
 * - If packageName is undefined → use path basename or repo name
 * 
 * @throws Error if path contains duplicate skill segments (validation)
 */
export function generateGitHubPackageName(
  context: GitHubPackageNamingContext
): string {
  const {
    gitUrl,
    path,
    packageName,
    repoPath
  } = context;
  
  // Validate path to catch duplicate skill path bugs
  if (path) {
    // Check for any path that has /skills/ appearing twice
    const skillsSegments = (path.match(/\/skills\//g) || []).length;
    const startsWithSkills = path.startsWith('skills/');
    const totalSkillsOccurrences = skillsSegments + (startsWithSkills ? 1 : 0);
    
    if (totalSkillsOccurrences > 1) {
      throw new Error(
        `Duplicate skill path segment detected: ${path}\n` +
        `Path contains multiple /skills/ segments (found ${totalSkillsOccurrences}). ` +
        `For skill packages, context.path should already include the full path.\n` +
        `Do NOT append skillMetadata.skillPath to context.path.`
      );
    }
  }
  
  // If no Git URL, use package name or fallback
  if (!gitUrl) {
    return packageName || (path ? basename(path) : 'unnamed-package');
  }
  
  // Try to extract GitHub info
  const githubInfo = extractGitHubInfo(gitUrl);
  
  // If not GitHub, use package name as-is
  if (!githubInfo) {
    logger.debug('Non-GitHub URL, using package name as-is', { gitUrl });
    return packageName || (path ? basename(path) : 'unnamed-package');
  }
  
  // GitHub URL - generate scoped name
  const { username, repo } = githubInfo;
  
  // If there's a subdirectory path, include it for uniqueness
  if (path) {
    // Use the full path for maximum clarity and unambiguity
    // Example: plugins/feature-dev -> gh@username/repo/plugins/feature-dev
    const normalizedPath = path.toLowerCase();
    return `gh@${username}/${repo}/${normalizedPath}`;
  } else {
    // Root of repo: gh@username/repo
    return `gh@${username}/${repo}`;
  }
}

/**
 * DEPRECATED: Use generateGitHubPackageName instead.
 * Kept for backward compatibility with plugin-specific code.
 * 
 * @deprecated
 */
export function generatePluginName(
  context: GitHubPackageNamingContext
): string {
  return generateGitHubPackageName(context);
}

/**
 * DEPRECATED: Use GitHubPackageNamingContext instead.
 * Kept for backward compatibility.
 * 
 * @deprecated
 */
export type PluginNamingContext = GitHubPackageNamingContext;

/**
 * Generate a scoped name for a marketplace.
 * Uses the unified GitHub package naming system.
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
  // Reuse the unified naming function for consistency
  return generateGitHubPackageName({
    gitUrl,
    packageName: marketplaceManifestName,
    repoPath
  });
}

/**
 * Parse a scoped plugin name into its components.
 * Supports GitHub (gh@username/repo or gh@username/repo/path) and
 * old (@username/...) formats.
 * Returns null if the name is not scoped.
 */
export function parseScopedPluginName(name: string): {
  username: string;
  repo: string;
  plugin?: string;
  isGitHub: boolean;
} | null {
  // GitHub format: gh@username/repo or gh@username/repo/...
  const ghMatch = name.match(/^gh@([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
  if (ghMatch) {
    const [, username, repo, rest] = ghMatch;
    
    // If has path after repo
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
export function detectOldPluginNaming(dep: { name: string; git?: string; url?: string; path?: string; subdirectory?: string }): string | null {
  // Only check GitHub git/url sources with scoped names
  const gitUrlRaw = dep.url || dep.git;
  if (!gitUrlRaw || !dep.name.startsWith('@')) {
    return null;
  }
  
  // Parse url to get base url (strip ref if present)
  const gitUrl = gitUrlRaw.includes('#') ? gitUrlRaw.split('#', 2)[0] : gitUrlRaw;
  
  const githubInfo = extractGitHubInfo(gitUrl);
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
  
  // If there's a path, this should be a 3-part name
  if (dep.path) {
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
 * Old format: @username/repo or @username/repo/path
 * New format: gh@username/repo or gh@username/repo/path
 * 
 * Also handles path mismatches where package name doesn't match the path/subdirectory field.
 */
export function detectOldGitHubNaming(dep: { name: string; git?: string; url?: string; path?: string; subdirectory?: string }): string | null {
  // Skip if not a git/url source
  const gitUrlRaw = dep.url || dep.git;
  if (!gitUrlRaw) {
    return null;
  }
  
  // Parse url to get base url (strip ref if present)
  const gitUrl = gitUrlRaw.includes('#') ? gitUrlRaw.split('#', 2)[0] : gitUrlRaw;
  
  const githubInfo = extractGitHubInfo(gitUrl);
  if (!githubInfo) {
    return null;
  }
  
  const { username, repo } = githubInfo;
  
  // Get the actual path (prefer path over subdirectory, normalize subdirectory)
  const actualPath = dep.path || (dep.subdirectory?.startsWith('./') 
    ? dep.subdirectory.substring(2) 
    : dep.subdirectory);
  
  // Check if name is missing gh@ prefix
  if (!dep.name.startsWith('gh@')) {
    // Handle old format with @ prefix
    if (dep.name.startsWith('@')) {
      // @username/repo/path or @username/repo
      if (actualPath) {
        return `gh@${username}/${repo}/${actualPath}`;
      }
      return `gh@${username}/${repo}`;
    }
    
    // Handle format without @ prefix: username/repo/path or username/repo
    // This happens when the @ was stripped somewhere
    if (actualPath) {
      return `gh@${username}/${repo}/${actualPath}`;
    }
    return `gh@${username}/${repo}`;
  }
  
  // Check if package name path matches the actual path field
  // This handles cases where name has basename instead of full path
  if (actualPath && dep.name.startsWith('gh@')) {
    // Extract the path portion from the package name
    const nameMatch = dep.name.match(/^gh@([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
    if (nameMatch) {
      const [, nameUsername, nameRepo, namePath] = nameMatch;
      
      // Verify username and repo match
      if (nameUsername === username && nameRepo === repo) {
        // If actualPath exists but namePath is different, update to use full path
        if (namePath !== actualPath) {
          return `gh@${username}/${repo}/${actualPath}`;
        }
      }
    }
  }
  
  return null;
}
