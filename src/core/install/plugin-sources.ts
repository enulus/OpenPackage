/**
 * Plugin source type definitions and normalization.
 * Implements Claude Code marketplace plugin source specification.
 * 
 * See: https://code.claude.com/docs/en/plugin-marketplaces#plugin-sources
 */

import { parseGitUrl } from '../../utils/git-url-parser.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Structured source object types from Claude Code spec.
 * 
 * Supported source types:
 * - Relative paths: string like "./plugins/my-plugin"
 * - GitHub: { source: 'github', repo: 'owner/repo', ref?, path? }
 * - Git URL: { source: 'url', url: 'https://...', ref?, path? }
 */
export type PluginSourceSpec = string | PluginSourceObject;

export type PluginSourceObject = GitHubSource | GitUrlSource;

export interface GitHubSource {
  source: 'github';
  repo: string;        // "owner/repo" format
  ref?: string;        // Optional branch/tag/sha
  path?: string;       // Optional subdirectory within repo
}

export interface GitUrlSource {
  source: 'url';
  url: string;         // Full git URL
  ref?: string;        // Optional branch/tag/sha
  path?: string;       // Optional subdirectory
}

/**
 * Normalized plugin source for internal use.
 * All source types are converted to this common format.
 */
export interface NormalizedPluginSource {
  type: 'relative-path' | 'git';
  
  // For relative-path type
  relativePath?: string;
  
  // For git type (both GitHub and Git URL)
  gitUrl?: string;
  gitRef?: string;
  gitSubdirectory?: string;
  
  // Original spec for reference
  rawSource: PluginSourceSpec;
}

/**
 * Normalize a plugin source spec into a consistent internal format.
 * Handles all source types from the Claude Code marketplace spec.
 * 
 * @param source - Plugin source from marketplace manifest
 * @param pluginName - Plugin name for error messages
 * @returns Normalized source
 * @throws ValidationError if source is invalid
 */
export function normalizePluginSource(
  source: PluginSourceSpec,
  pluginName: string
): NormalizedPluginSource {
  if (!source) {
    throw new ValidationError(
      `Plugin '${pluginName}' missing required 'source' field`
    );
  }
  
  // Case 1: String source (relative path)
  if (typeof source === 'string') {
    return normalizeRelativePathSource(source, pluginName);
  }
  
  // Case 2: Structured source object
  const sourceObj = source as PluginSourceObject;
  
  if (!sourceObj.source) {
    throw new ValidationError(
      `Plugin '${pluginName}' has invalid source object: missing 'source' field`
    );
  }
  
  switch (sourceObj.source) {
    case 'github':
      return normalizeGitHubSource(sourceObj as GitHubSource, pluginName);
    
    case 'url':
      return normalizeGitUrlSource(sourceObj as GitUrlSource, pluginName);
    
    default:
      throw new ValidationError(
        `Plugin '${pluginName}' has unsupported source type: '${(sourceObj as any).source}'. ` +
        `Supported types: 'github', 'url', or relative path string`
      );
  }
}

/**
 * Normalize a relative path source.
 */
function normalizeRelativePathSource(
  path: string,
  pluginName: string
): NormalizedPluginSource {
  // Validate path doesn't traverse upward beyond marketplace root
  if (path.includes('..')) {
    throw new ValidationError(
      `Plugin '${pluginName}' source path contains '..' which is not allowed for security reasons`
    );
  }
  
  // Validate path is not absolute
  if (path.startsWith('/')) {
    throw new ValidationError(
      `Plugin '${pluginName}' source path must be relative to marketplace root, not absolute`
    );
  }
  
  logger.debug('Normalized relative path source', { pluginName, path });
  
  return {
    type: 'relative-path',
    relativePath: path,
    rawSource: path
  };
}

/**
 * Normalize a GitHub source.
 */
function normalizeGitHubSource(
  source: GitHubSource,
  pluginName: string
): NormalizedPluginSource {
  // Validate repo format
  if (!source.repo) {
    throw new ValidationError(
      `Plugin '${pluginName}' GitHub source missing 'repo' field`
    );
  }
  
  if (!source.repo.includes('/')) {
    throw new ValidationError(
      `Plugin '${pluginName}' GitHub source 'repo' must be in 'owner/repo' format, got: '${source.repo}'`
    );
  }
  
  const parts = source.repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ValidationError(
      `Plugin '${pluginName}' GitHub source 'repo' must be in 'owner/repo' format, got: '${source.repo}'`
    );
  }
  
  // Convert to full git URL
  const gitUrl = `https://github.com/${source.repo}.git`;
  
  logger.debug('Normalized GitHub source', { 
    pluginName, 
    repo: source.repo, 
    ref: source.ref,
    path: source.path,
    gitUrl 
  });
  
  return {
    type: 'git',
    gitUrl,
    gitRef: source.ref,
    gitSubdirectory: source.path,
    rawSource: source
  };
}

/**
 * Normalize a Git URL source.
 */
function normalizeGitUrlSource(
  source: GitUrlSource,
  pluginName: string
): NormalizedPluginSource {
  // Validate URL field exists
  if (!source.url) {
    throw new ValidationError(
      `Plugin '${pluginName}' Git URL source missing 'url' field`
    );
  }
  
  // Validate URL format by attempting to parse it
  try {
    parseGitUrl(source.url);
  } catch (error) {
    throw new ValidationError(
      `Plugin '${pluginName}' has invalid Git URL: ${source.url}. ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  
  logger.debug('Normalized Git URL source', { 
    pluginName, 
    url: source.url,
    ref: source.ref,
    path: source.path
  });
  
  return {
    type: 'git',
    gitUrl: source.url,
    gitRef: source.ref,
    gitSubdirectory: source.path,
    rawSource: source
  };
}

/**
 * Check if a normalized source is a relative path.
 */
export function isRelativePathSource(source: NormalizedPluginSource): boolean {
  return source.type === 'relative-path';
}

/**
 * Check if a normalized source is a git source (GitHub or Git URL).
 */
export function isGitSource(source: NormalizedPluginSource): boolean {
  return source.type === 'git';
}
