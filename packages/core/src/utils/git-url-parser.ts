import { ValidationError } from './errors.js';

/**
 * Parsed Git URL components.
 */
export interface ParsedGitUrl {
  host: string;        // github.com, gitlab.com, etc.
  owner: string;       // username or org
  repo: string;        // repository name (without .git)
  protocol: 'https' | 'ssh' | 'git';
  normalized: string;  // Normalized URL for hashing
}

/**
 * GitHub-specific metadata extracted from URL.
 */
export interface GitHubInfo {
  username: string;
  repo: string;
}

/**
 * Normalize a Git URL for consistent hashing.
 * - Converts to lowercase
 * - Removes .git suffix
 * - Normalizes GitHub SSH to HTTPS format
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.toLowerCase().trim();
  
  // Remove .git suffix
  if (normalized.endsWith('.git')) {
    normalized = normalized.slice(0, -4);
  }
  
  // Normalize GitHub SSH to HTTPS
  if (normalized.startsWith('git@github.com:')) {
    normalized = normalized.replace('git@github.com:', 'https://github.com/');
  }
  
  // Normalize other SSH formats
  if (normalized.startsWith('git@')) {
    // git@gitlab.com:owner/repo → https://gitlab.com/owner/repo
    normalized = normalized.replace(/^git@([^:]+):/, 'https://$1/');
  }
  
  // Remove trailing slashes
  normalized = normalized.replace(/\/$/, '');
  
  return normalized;
}

/**
 * Parse a Git URL into its components.
 * Supports various formats:
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - https://gitlab.com/group/subgroup/repo.git
 * - ssh://git@bitbucket.org/owner/repo.git
 */
export function parseGitUrl(url: string): ParsedGitUrl {
  const normalized = normalizeGitUrl(url);
  
  // Try HTTPS format first
  const httpsMatch = normalized.match(/^https?:\/\/([^\/]+)\/(.+?)\/([^\/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, host, owner, repo] = httpsMatch;
    return {
      host,
      owner,
      repo,
      protocol: 'https',
      normalized
    };
  }
  
  // Try SSH format (already normalized to https above, but handle edge cases)
  const sshMatch = normalized.match(/^(?:ssh:\/\/)?git@([^:\/]+)[:\\/](.+?)\/([^\/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, owner, repo] = sshMatch;
    return {
      host,
      owner,
      repo,
      protocol: 'ssh',
      normalized: `https://${host}/${owner}/${repo}` // Normalize for consistency
    };
  }
  
  // Try git:// protocol
  const gitMatch = normalized.match(/^git:\/\/([^\/]+)\/(.+?)\/([^\/]+?)(?:\.git)?$/);
  if (gitMatch) {
    const [, host, owner, repo] = gitMatch;
    return {
      host,
      owner,
      repo,
      protocol: 'git',
      normalized: `https://${host}/${owner}/${repo}`
    };
  }
  
  throw new ValidationError(
    `Unable to parse Git URL: ${url}. Expected format: https://host/owner/repo.git or git@host:owner/repo.git`
  );
}

/**
 * Extract GitHub metadata from a Git URL.
 * Returns null if the URL is not a GitHub URL.
 */
export function extractGitHubInfo(url: string): GitHubInfo | null {
  try {
    const parsed = parseGitUrl(url);
    
    // Only handle github.com
    if (parsed.host !== 'github.com') {
      return null;
    }
    
    return {
      username: parsed.owner,
      repo: parsed.repo
    };
  } catch {
    return null;
  }
}

/**
 * Check if a URL is a GitHub URL.
 */
export function isGitHubUrl(url: string): boolean {
  return extractGitHubInfo(url) !== null;
}

/**
 * Sanitize a Git ref name for use in filesystem paths.
 * Converts slashes and other problematic characters to hyphens.
 * 
 * Examples:
 * - main → main
 * - feature/new-thing → feature-new-thing
 * - v1.0.0 → v1.0.0
 */
export function sanitizeRefName(ref: string): string {
  return ref.replace(/[\/\\:]/g, '-');
}
