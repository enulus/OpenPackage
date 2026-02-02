/**
 * Unified resource argument parsing for the install command.
 * 
 * Parses resource specifications in priority order:
 * 1. URL (GitHub URLs)
 * 2. Resource Name (with or without `@` symbol)
 * 3. Filepath (absolute or relative)
 * 
 * Supports version specifications only at repo/package level, not on sub-paths.
 */

import { resolve, isAbsolute } from 'path';
import { exists } from './fs.js';
import { parseGitHubUrl, parseGitHubShorthand, isGitUrl } from './git-url-detection.js';
import { ValidationError } from './errors.js';
import { logger } from './logger.js';

/**
 * Resource specification interface
 */
export interface ResourceSpec {
  /** How the resource was specified */
  type: 'github-url' | 'github-shorthand' | 'registry' | 'filepath';
  
  /** Repository identifier (for git sources) */
  repo?: string;
  
  /** Git URL (for git sources) */
  gitUrl?: string;
  
  /** Git ref/version (branch, tag, commit) */
  ref?: string;
  
  /** Path within repo/package to the resource */
  path?: string;
  
  /** Package name (for registry sources) */
  name?: string;
  
  /** Version constraint (for registry sources) */
  version?: string;
  
  /** Absolute path (for filepath sources) */
  absolutePath?: string;
  
  /** Whether path points to a directory */
  isDirectory?: boolean;
}

/**
 * Parse a resource argument string into a ResourceSpec.
 * 
 * Resolution order:
 * 1. GitHub URL → Extract repo + path
 * 2. GitHub Shorthand (gh@) → Parse segments
 * 3. Filepath → Resolve and validate
 * 4. Registry Name → Parse name + version
 * 
 * @param input - Raw user input
 * @param cwd - Current working directory for resolving relative paths
 * @returns Parsed ResourceSpec
 */
export async function parseResourceArg(
  input: string,
  cwd: string = process.cwd()
): Promise<ResourceSpec> {
  if (!input || typeof input !== 'string') {
    throw new ValidationError('Resource argument cannot be empty');
  }

  // 1. GitHub URL
  if (input.startsWith('https://github.com/') || input.startsWith('http://github.com/')) {
    return parseGitHubUrlResource(input);
  }

  // 2. GitHub shorthand
  if (input.startsWith('gh@')) {
    return parseGitHubShorthandResource(input);
  }

  // 3. Filepath detection (before registry to avoid false positives)
  if (looksLikePath(input)) {
    const resolved = isAbsolute(input) ? input : resolve(cwd, input);
    
    if (await exists(resolved)) {
      const stat = await import('fs/promises').then(m => m.stat(resolved));
      return {
        type: 'filepath',
        absolutePath: resolved,
        isDirectory: stat.isDirectory()
      };
    }
    
    // Path syntax but doesn't exist - could still be registry
    // Only error if it's unambiguously a path
    if (isUnambiguouslyPath(input)) {
      throw new ValidationError(`Path not found: ${input}`);
    }
  }

  // 4. Registry resource name
  return parseRegistryResource(input);
}

/**
 * Parse a GitHub URL into a ResourceSpec.
 */
function parseGitHubUrlResource(input: string): ResourceSpec {
  const gitSpec = parseGitHubUrl(input);
  
  if (!gitSpec) {
    throw new ValidationError(`Invalid GitHub URL: ${input}`);
  }

  // Extract owner/repo from the git URL
  const match = gitSpec.url.match(/github\.com[/:]([\w-]+)\/([\w-]+)(?:\.git)?$/);
  if (!match) {
    throw new ValidationError(`Could not extract repository from URL: ${input}`);
  }

  const [, owner, repo] = match;

  logger.debug('Parsed GitHub URL resource', {
    input,
    repo: `${owner}/${repo}`,
    ref: gitSpec.ref,
    path: gitSpec.path
  });

  return {
    type: 'github-url',
    repo: `${owner}/${repo}`,
    gitUrl: gitSpec.url,
    ref: gitSpec.ref,
    path: gitSpec.path
  };
}

/**
 * Parse GitHub shorthand (gh@owner/repo[/path][@version]) into a ResourceSpec.
 */
function parseGitHubShorthandResource(input: string): ResourceSpec {
  // Check for version at the end first
  let baseInput = input;
  let version: string | undefined;
  
  // Look for @version at the end (after repo identifier)
  // Format: gh@owner/repo[@version][/path]
  // We need to be careful: gh@owner/repo@v1.0/path vs gh@owner/repo/path
  const segments = input.slice(3).split('/'); // Remove 'gh@'
  
  if (segments.length >= 2) {
    // Check if second segment has @version
    const repoSegment = segments[1];
    const atIndex = repoSegment.indexOf('@');
    
    if (atIndex > 0) {
      version = repoSegment.slice(atIndex + 1);
      segments[1] = repoSegment.slice(0, atIndex);
      baseInput = 'gh@' + segments.join('/');
    }
  }

  const gitSpec = parseGitHubShorthand(baseInput);
  
  if (!gitSpec) {
    throw new ValidationError(`Invalid GitHub shorthand: ${input}`);
  }

  // Extract owner/repo from the git URL
  const match = gitSpec.url.match(/github\.com[/:]([\w-]+)\/([\w-]+)(?:\.git)?$/);
  if (!match) {
    throw new ValidationError(`Could not extract repository from shorthand: ${input}`);
  }

  const [, owner, repo] = match;

  logger.debug('Parsed GitHub shorthand resource', {
    input,
    repo: `${owner}/${repo}`,
    ref: version || gitSpec.ref,
    path: gitSpec.path
  });

  return {
    type: 'github-shorthand',
    repo: `${owner}/${repo}`,
    gitUrl: gitSpec.url,
    ref: version || gitSpec.ref,
    path: gitSpec.path
  };
}

/**
 * Parse a registry/OpenPackage resource name.
 * 
 * Format: [@scope/]name[/path][@version]
 */
function parseRegistryResource(input: string): ResourceSpec {
  // Parse name[@version] and optional path
  // Examples:
  //   @hyericlee/essentials
  //   @hyericlee/essentials/agents/designer
  //   my-package@1.0.0
  //   hyericlee/essentials (could be path or registry)
  
  let name: string;
  let version: string | undefined;
  let path: string | undefined;
  
  // Check for version specification
  const atIndex = input.lastIndexOf('@');
  
  if (atIndex > 0) {
    // Has version
    const beforeAt = input.slice(0, atIndex);
    version = input.slice(atIndex + 1);
    
    // Check if version contains path separator (invalid)
    if (version.includes('/')) {
      throw new ValidationError(
        `Version cannot be specified on sub-paths.\n\n` +
        `Got: ${input}\n\n` +
        `Valid format: package[@version][/path]\n` +
        `Example: my-package@1.0.0/agents/designer`
      );
    }
    
    // Parse name and path from beforeAt
    const segments = beforeAt.split('/');
    if (beforeAt.startsWith('@')) {
      // Scoped package: @scope/name[/path/...]
      if (segments.length < 2) {
        throw new ValidationError(`Invalid scoped package name: ${input}`);
      }
      name = segments.slice(0, 2).join('/');
      path = segments.length > 2 ? segments.slice(2).join('/') : undefined;
    } else {
      // Unscoped package: name[/path/...]
      name = segments[0];
      path = segments.length > 1 ? segments.slice(1).join('/') : undefined;
    }
  } else {
    // No version
    const segments = input.split('/');
    if (input.startsWith('@')) {
      // Scoped package
      if (segments.length < 2) {
        throw new ValidationError(`Invalid scoped package name: ${input}`);
      }
      name = segments.slice(0, 2).join('/');
      path = segments.length > 2 ? segments.slice(2).join('/') : undefined;
    } else {
      // Unscoped package
      name = segments[0];
      path = segments.length > 1 ? segments.slice(1).join('/') : undefined;
    }
  }

  logger.debug('Parsed registry resource', {
    input,
    name,
    version,
    path
  });

  return {
    type: 'registry',
    name,
    version,
    path
  };
}

/**
 * Check if input looks like a filesystem path.
 */
function looksLikePath(input: string): boolean {
  return (
    input.startsWith('/') ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('~') ||
    input === '.' ||
    (isAbsolute(input) && !input.includes('@'))
  );
}

/**
 * Check if input is unambiguously a path (not a registry name).
 */
function isUnambiguouslyPath(input: string): boolean {
  return (
    input.startsWith('/') ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('~')
  );
}
