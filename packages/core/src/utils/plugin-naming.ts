import { basename } from 'path';
import { extractGitHubInfo } from './git-url-parser.js';
import { DIR_TO_TYPE, STRUCTURAL_PREFIX_DIRS } from '../constants/index.js';
import { logger } from './logger.js';

/**
 * Context for generating scoped package names from GitHub sources.
 * Used for both Claude plugins and OpenPackage repositories.
 */
export interface GitHubPackageNamingContext {
  gitUrl?: string;              // Git URL (for extracting GitHub info)
  path?: string;                // Path within repo (subdirectory)
  resourcePath?: string;        // Full resource path within repo
  packageName?: string;         // Name from manifest (plugin.json or openpackage.yml)
  repoPath?: string;            // Path to repository root (for fallback)
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
 */
export function generateGitHubPackageName(
  context: GitHubPackageNamingContext
): string {
  const {
    gitUrl,
    path,
    resourcePath,
    packageName,
    repoPath
  } = context;
  const pathToUse = resourcePath ?? path;
  const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\/?/, '').toLowerCase();
  
  // If no Git URL, use package name or fallback
  if (!gitUrl) {
    if (packageName && pathToUse) {
      return `${packageName}/${normalizePath(pathToUse)}`;
    }
    return packageName || (pathToUse ? basename(pathToUse) : 'unnamed-package');
  }
  
  // Try to extract GitHub info
  const githubInfo = extractGitHubInfo(gitUrl);
  
  // If not GitHub, use package name as-is
  if (!githubInfo) {
    logger.debug('Non-GitHub URL, using package name as-is', { gitUrl });
    if (packageName && pathToUse) {
      return `${packageName}/${normalizePath(pathToUse)}`;
    }
    return packageName || (pathToUse ? basename(pathToUse) : 'unnamed-package');
  }
  
  // GitHub URL - generate scoped name
  const { username, repo } = githubInfo;
  
  // If there's a subdirectory path, include it for uniqueness
  if (pathToUse) {
    // Use the full path for maximum clarity and unambiguity
    // Example: plugins/feature-dev -> gh@username/repo/plugins/feature-dev
    const normalizedPath = normalizePath(pathToUse);
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
 * Split a package name into base package name and resource path for telemetry.
 * Handles GitHub-scoped names that may include resource paths.
 * 
 * Examples:
 * - "gh@user/repo/agents/designer" → { baseName: "gh@user/repo", resourcePath: "agents/designer" }
 * - "gh@user/repo" → { baseName: "gh@user/repo", resourcePath: undefined }
 * - "@scope/package/path" → { baseName: "@scope/package", resourcePath: "path" }
 * - "simple-package" → { baseName: "simple-package", resourcePath: undefined }
 * 
 * @param packageName - Full package name (may include resource path)
 * @returns Object with base package name and optional resource path
 */
export function splitPackageNameForTelemetry(packageName: string): {
  baseName: string;
  resourcePath?: string;
} {
  // Handle GitHub format: gh@username/repo[/path]
  const ghMatch = packageName.match(/^gh@([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
  if (ghMatch) {
    const [, username, repo, path] = ghMatch;
    return {
      baseName: `gh@${username}/${repo}`,
      resourcePath: path
    };
  }
  
  // Handle scoped format: @scope/name[/path]
  const scopedMatch = packageName.match(/^@([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
  if (scopedMatch) {
    const [, scope, name, path] = scopedMatch;
    return {
      baseName: `@${scope}/${name}`,
      resourcePath: path
    };
  }
  
  // Handle unscoped format with path: name/path
  // Need to be careful not to split "owner/repo" GitHub shorthand
  // If it doesn't match gh@ or @ format, treat first segment as package name
  const segments = packageName.split('/');
  if (segments.length > 1) {
    // Ambiguous case: could be "name/path" or just "owner/repo"
    // For telemetry safety, only split if we have 2+ slashes (clear path indicator)
    if (segments.length > 2) {
      return {
        baseName: segments[0],
        resourcePath: segments.slice(1).join('/')
      };
    }
  }
  
  // No path detected, return as-is
  return {
    baseName: packageName,
    resourcePath: undefined
  };
}

/**
 * Strip a file extension from a path segment (e.g. "code-reviewer.md" → "code-reviewer").
 */
function stripExtension(segment: string): string {
  const dotIdx = segment.lastIndexOf('.');
  return dotIdx > 0 ? segment.slice(0, dotIdx) : segment;
}

/**
 * Derive a short, human-readable namespace slug from a full package name.
 *
 * Uses "smart leaf detection": walks the sub-path segments and identifies
 * the meaningful name segment using a three-tier strategy:
 *
 * 1. **Resource marker** — if a resource-type directory (`rules`, `agents`,
 *    `commands`, `skills`, `hooks` from `DIR_TO_TYPE`) appears at index > 0,
 *    the segment immediately before it is the leaf.
 * 2. **Structural prefix** — if no resource marker is found (or it's at
 *    index 0), and a known structural prefix directory (`plugins`,
 *    `packages`) exists, the segment immediately *after* it is the leaf.
 * 3. **Repo fallback** — if neither strategy applies, the repo name is used.
 *
 * The slug uses `/` as separators so it produces real nested directories.
 *
 * ### Escalation for uniqueness
 *
 * If `existingSlugs` is provided, the function progressively escalates
 * to avoid collisions:
 *   1. `leaf`               (e.g. "feature-dev")
 *   2. `repo/leaf`          (e.g. "claude-plugins/feature-dev")
 *   3. `owner/repo/leaf`    (e.g. "anthropics/claude-plugins/feature-dev")
 *
 * For repo-level packages (no sub-path):
 *   1. `repo`               (e.g. "essentials")
 *   2. `owner/repo`         (e.g. "anthropics/essentials")
 *
 * For plain registry names (not scoped): returned as-is with no escalation.
 *
 * ### Examples
 *
 *  | Package Name                                                  | Slug (no collision) |
 *  |---------------------------------------------------------------|---------------------|
 *  | gh@owner/repo/plugins/foo/commands/bar/baz/hello.md           | foo                 |
 *  | gh@anthropics/claude-plugins/plugins/feature-dev/agents/x.md  | feature-dev         |
 *  | gh@anthropics/repo/plugins/code-review                        | code-review         |
 *  | gh@owner/repo/packages/my-tool                                | my-tool             |
 *  | gh@anthropics/essentials                                      | essentials          |
 *  | gh@owner/repo/agents/designer.md                              | repo                |
 *  | gh@owner/repo/tools/linter                                    | repo                |
 *  | my-plain-package                                              | my-plain-package    |
 *  | @scope/package-name                                           | package-name        |
 *
 * @param packageName    Full canonical package name
 * @param existingSlugs  Set of slugs already in use by other installed packages.
 *                       When provided, the function escalates to avoid collisions.
 */
export function deriveNamespaceSlug(
  packageName: string,
  existingSlugs?: Set<string>
): string {
  const parsed = parseScopedPluginName(packageName);

  // ── Plain registry name (not scoped) ──────────────────────────────────
  if (!parsed) {
    return packageName;
  }

  const { username, repo, plugin } = parsed;
  const resourceDirNames = new Set(Object.keys(DIR_TO_TYPE));

  // ── Determine the leaf ────────────────────────────────────────────────
  let leaf: string;

  if (!plugin) {
    // Repo-level package: gh@owner/repo — leaf is repo
    leaf = repo;
  } else {
    const segments = plugin.split('/');
    const markerIndex = segments.findIndex(seg => resourceDirNames.has(seg));

    if (markerIndex > 0) {
      // Segment immediately before the first resource marker
      leaf = stripExtension(segments[markerIndex - 1]);
    } else if (markerIndex === 0) {
      // Marker at index 0 (e.g. "agents/designer.md") — package IS the repo
      leaf = repo;
    } else {
      // No resource marker found — check for known structural prefix directories
      // (e.g. "plugins/code-review", "packages/my-tool")
      const prefixIndex = segments.findIndex(seg => STRUCTURAL_PREFIX_DIRS.has(seg));

      if (prefixIndex >= 0 && prefixIndex + 1 < segments.length) {
        // Use the segment immediately after the structural prefix
        leaf = stripExtension(segments[prefixIndex + 1]);
      } else {
        // No recognized structure — fall back to repo
        leaf = repo;
      }
    }
  }

  // ── Build escalation candidates ───────────────────────────────────────
  const candidates: string[] = !plugin
    ? [repo, `${username}/${repo}`]
    : leaf === repo
      ? // Leaf is already the repo — start at repo, escalate to owner/repo
        [repo, `${username}/${repo}`]
      : [leaf, `${repo}/${leaf}`, `${username}/${repo}/${leaf}`];

  // ── Pick the shortest non-colliding slug ──────────────────────────────
  if (!existingSlugs || existingSlugs.size === 0) {
    return candidates[0];
  }

  for (const candidate of candidates) {
    if (!existingSlugs.has(candidate)) {
      return candidate;
    }
  }

  // All candidates collide (extremely unlikely) — fall back to full name
  // with problematic characters stripped
  return packageName.replace(/^gh@/, '').replace(/@/g, '');
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
