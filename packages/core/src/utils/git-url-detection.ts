/**
 * Modern git source detection and parsing.
 * Supports:
 * - GitHub shorthand (gh@owner/repo[/path])
 * - GitHub web URLs (https://github.com/owner/repo/tree/ref/path)
 * - Generic git URLs with hash fragments (#ref&path=x)
 * - Legacy prefixes (github:, git:) with deprecation warnings
 */

import { ValidationError } from './errors.js';
import { logger } from './logger.js';

/**
 * Parsed git source specification.
 */
export interface GitSpec {
  url: string;       // Normalized git URL
  ref?: string;      // Branch/tag/commit
  path?: string;     // Subdirectory within repo
}

/**
 * Detect and parse git sources from user input.
 * Returns null if input is not a git source.
 * 
 * Detection priority (by user intent):
 * 1. GitHub shorthand (gh@) - new explicit syntax
 * 2. URL protocols (https://, http://, git://, git@) - direct URLs
 * 3. Git file extension (.git) - any URL ending with .git
 * 4. Legacy prefixes (github:, git:) - deprecated, with warnings
 * 
 * Implementation order (to avoid conflicts):
 * - Legacy prefixes checked first (they mask underlying URL patterns)
 * - GitHub shorthand (explicit new syntax)
 * - GitHub URLs (specific pattern matching)
 * - Generic git URLs (catch-all)
 * 
 * @param input - Raw user input
 * @returns Parsed GitSpec or null if not a git source
 */
export function detectGitSource(input: string): GitSpec | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Check legacy prefixes first (they hide the URL underneath)
  const legacy = parseLegacyPrefix(input);
  if (legacy) {
    return legacy;
  }

  // GitHub shorthand (gh@owner/repo)
  const ghShorthand = parseGitHubShorthand(input);
  if (ghShorthand) {
    return ghShorthand;
  }

  // GitHub URLs (extract ref/path from URL structure)
  const ghUrl = parseGitHubUrl(input);
  if (ghUrl) {
    return ghUrl;
  }

  // Generic git URLs (with hash fragments)
  const genericGit = parseGenericGitUrl(input);
  if (genericGit) {
    return genericGit;
  }

  return null;
}

/**
 * Parse GitHub shorthand format: gh@owner/repo[/path]
 * 
 * Examples:
 * - gh@anthropics/claude-code
 * - gh@user/repo/plugins/x
 * 
 * @param input - Raw input string
 * @returns GitSpec or null if not GitHub shorthand
 */
export function parseGitHubShorthand(input: string): GitSpec | null {
  if (!input.startsWith('gh@')) {
    return null;
  }

  const remainder = input.slice(3); // Remove 'gh@'
  
  if (!remainder) {
    throw new ValidationError(
      `Invalid GitHub shorthand 'gh@'. Expected format: gh@owner/repo[/path]\n\n` +
      `Examples:\n` +
      `  gh@anthropics/claude-code\n` +
      `  gh@user/repo/plugins/my-plugin`
    );
  }

  const segments = remainder.split('/').filter(s => s.length > 0);
  
  if (segments.length < 2) {
    throw new ValidationError(
      `Invalid GitHub shorthand '${input}'. Expected format: gh@owner/repo[/path]\n\n` +
      `Examples:\n` +
      `  gh@anthropics/claude-code\n` +
      `  gh@user/repo/plugins/my-plugin`
    );
  }

  const owner = segments[0];
  const repo = segments[1];

  const url = normalizeGitHubUrl(owner, repo);
  const path = segments.length > 2 ? segments.slice(2).join('/') : undefined;

  logger.debug('Parsed GitHub shorthand', { input, owner, repo, path, url });

  return {
    url,
    ref: undefined, // GitHub shorthand always uses default branch
    path
  };
}

/**
 * Parse GitHub web URLs.
 * 
 * Supported formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/tree/ref
 * - https://github.com/owner/repo/tree/ref/path
 * 
 * @param input - Raw input string
 * @returns GitSpec or null if not a GitHub URL
 */
export function parseGitHubUrl(input: string): GitSpec | null {
  let url: URL;
  
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  // Must be github.com
  if (url.hostname !== 'github.com') {
    return null;
  }

  const segments = url.pathname.split('/').filter(s => s.length > 0);
  
  if (segments.length < 2) {
    throw new ValidationError(
      `Invalid GitHub URL. Expected: https://github.com/owner/repo\n\n` +
      `Got: ${input}`
    );
  }

  const owner = segments[0];
  let repo = segments[1];
  
  // Strip .git suffix from repo if present
  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  const normalizedUrl = normalizeGitHubUrl(owner, repo);
  let ref: string | undefined;
  let path: string | undefined;

  // Check for /tree/ or /blob/ paths
  if (segments.length > 2) {
    const pathType = segments[2];
    
    if (pathType === 'blob') {
      throw new ValidationError(
        `Cannot install from single file URL\n\n` +
        `You provided:\n` +
        `  ${input}\n\n` +
        `To install a package, use:\n` +
        `  • Repository: https://github.com/${owner}/${repo}\n` +
        `  • With branch: https://github.com/${owner}/${repo}/tree/main\n` +
        `  • Subdirectory: https://github.com/${owner}/${repo}/tree/main/plugins/x\n` +
        `  • Shorthand: gh@${owner}/${repo}/plugins/x`
      );
    }
    
    if (pathType === 'tree') {
      if (segments.length < 4) {
        throw new ValidationError(
          `Invalid GitHub URL. Ref is required after /tree/\n\n` +
          `Got: ${input}\n\n` +
          `Expected: https://github.com/${owner}/${repo}/tree/<ref>[/path]`
        );
      }
      
      ref = decodeURIComponent(segments[3]);
      
      // Path is everything after the ref
      if (segments.length > 4) {
        path = segments.slice(4).map(s => decodeURIComponent(s)).join('/');
      }
    }
  }

  logger.debug('Parsed GitHub URL', { input, owner, repo, ref, path, url: normalizedUrl });

  return {
    url: normalizedUrl,
    ref,
    path
  };
}

/**
 * Parse generic git URLs with hash fragments.
 * 
 * Supported formats:
 * - https://host/path.git
 * - git://host/path
 * - git@host:path.git
 * - <any-git-url>#<ref>
 * - <any-git-url>#<ref>&path=<path>
 * - <any-git-url>#path=<path>
 * 
 * @param input - Raw input string
 * @returns GitSpec or null if not a git URL
 */
export function parseGenericGitUrl(input: string): GitSpec | null {
  if (!isGitUrl(input)) {
    return null;
  }

  // Split by # to separate base URL and hash fragment
  const [baseUrl, hashPart] = input.split('#', 2);
  
  const result: GitSpec = {
    url: baseUrl
  };

  // Parse hash fragment if present
  if (hashPart) {
    const { ref, path } = parseHashFragment(hashPart, input);
    if (ref) result.ref = ref;
    if (path) result.path = path;
  }

  logger.debug('Parsed generic git URL', { input, ...result });

  return result;
}

/**
 * Parse legacy prefix formats with deprecation warnings.
 * 
 * Supported formats:
 * - github:owner/repo[#ref][&subdirectory=path]
 * - git:<url>[#ref][&subdirectory=path]
 * 
 * @param input - Raw input string
 * @returns GitSpec or null if not using legacy prefix
 */
function parseLegacyPrefix(input: string): GitSpec | null {
  // Check for github: prefix
  if (input.startsWith('github:')) {
    logger.warn(`⚠️  The 'github:' prefix is deprecated. Use 'gh@user/repo' instead.`);
    
    const remainder = input.slice(7); // Remove 'github:'
    const [repoPart, hashPart] = remainder.split('#', 2);
    const [owner, repo] = repoPart.split('/');
    
    if (!owner || !repo) {
      throw new ValidationError(
        `Invalid github spec '${input}'. Expected github:owner/repo[#ref][&subdirectory=path]`
      );
    }
    
    const url = normalizeGitHubUrl(owner, repo);
    const result: GitSpec = { url };
    
    if (hashPart) {
      const { ref, path } = parseHashFragment(hashPart, input);
      if (ref) result.ref = ref;
      if (path) result.path = path;
    }
    
    return result;
  }
  
  // Check for git: prefix
  if (input.startsWith('git:')) {
    logger.warn(`⚠️  The 'git:' prefix is deprecated. Use the URL directly.`);
    
    const remainder = input.slice(4); // Remove 'git:'
    const [url, hashPart] = remainder.split('#', 2);
    
    if (!url) {
      throw new ValidationError(
        `Invalid git spec '${input}'. Expected git:<url>[#ref][&subdirectory=path]`
      );
    }
    
    const result: GitSpec = { url };
    
    if (hashPart) {
      const { ref, path } = parseHashFragment(hashPart, input);
      if (ref) result.ref = ref;
      if (path) result.path = path;
    }
    
    return result;
  }
  
  return null;
}

/**
 * Parse hash fragment for ref and path parameters.
 * 
 * Supported formats:
 * - #<ref>
 * - #path=<path>
 * - #subdirectory=<path> (backward compat, no warning)
 * - #<ref>&path=<path>
 * - #<ref>&subdirectory=<path>
 * 
 * @param hashPart - Hash fragment (without #)
 * @param fullInput - Full input for error messages
 * @returns Object with ref and path
 */
function parseHashFragment(
  hashPart: string,
  fullInput: string
): { ref?: string; path?: string } {
  const result: { ref?: string; path?: string } = {};
  
  // Split by & to get parts
  const parts = hashPart.split('&');
  
  for (const part of parts) {
    if (!part) continue;
    
    if (part.includes('=')) {
      // It's a key=value parameter
      const eqIndex = part.indexOf('=');
      const key = part.slice(0, eqIndex);
      const value = part.slice(eqIndex + 1);
      
      if (key === 'path' || key === 'subdirectory') {
        result.path = value;
      } else {
        throw new ValidationError(
          `Invalid hash fragment '#${hashPart}'\n\n` +
          `Unknown parameter: ${key}\n\n` +
          `Supported parameters:\n` +
          `  • ref (unnamed): #main\n` +
          `  • path: #path=plugins/x\n` +
          `  • combined: #main&path=plugins/x`
        );
      }
    } else {
      // It's the ref (branch/tag/sha)
      if (result.ref) {
        throw new ValidationError(
          `Multiple refs specified in hash fragment\n\n` +
          `Got: #${hashPart}\n\n` +
          `Use only one ref: #main or #v1.0.0`
        );
      }
      result.ref = part;
    }
  }
  
  return result;
}

/**
 * Check if input looks like a git URL.
 * 
 * Detection criteria:
 * - Starts with git protocol: https://, http://, git://, git@
 * - Ends with .git extension
 */
export function isGitUrl(input: string): boolean {
  return (
    input.startsWith('https://') ||
    input.startsWith('http://') ||
    input.startsWith('git://') ||
    input.startsWith('git@') ||
    input.endsWith('.git')
  );
}

/**
 * Normalize GitHub owner/repo to full git URL.
 * 
 * @param owner - GitHub username or org
 * @param repo - Repository name
 * @returns Normalized GitHub git URL
 */
export function normalizeGitHubUrl(owner: string, repo: string): string {
  // Ensure repo doesn't have .git suffix for consistent handling
  const cleanRepo = repo.endsWith('.git') ? repo.slice(0, -4) : repo;
  return `https://github.com/${owner}/${cleanRepo}.git`;
}
