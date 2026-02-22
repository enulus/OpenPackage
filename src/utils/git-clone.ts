import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { rm, rename } from 'fs/promises';

import { logger } from './logger.js';
import { ValidationError } from './errors.js';
import { exists, ensureDir } from './fs.js';
import { DIR_PATTERNS, FILE_PATTERNS } from '../constants/index.js';
import { Spinner } from './spinner.js';
import {
  getGitCommitCacheDir,
  getGitCachePath,
  getGitRepoCacheDir,
  writeRepoMetadata,
  writeCommitMetadata,
  readCommitMetadata,
  touchCacheEntry,
  isCommitCached
} from './git-cache.js';
import { createCacheManager } from '../core/cache-manager.js';
import { hasPluginContent } from '../core/install/plugin-detector.js';

const execFileAsync = promisify(execFile);
const cacheManager = createCacheManager();

export interface GitCloneOptions {
  url: string;
  ref?: string; // branch/tag/sha
  subdir?: string; // subdir within repository
  skipCache?: boolean; // Force fresh clone, bypass ref cache (for --remote flag)
}

export interface GitCloneResult {
  path: string;         // Full path to clone (including subdir if specified)
  commitSha: string;    // Resolved commit SHA (7 chars)
  repoPath: string;     // Path to repository root
}

function isSha(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref);
}

function isFullSha(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd });
    return result.stdout.trim();
  } catch (error: any) {
    const message = error?.stderr?.toString?.().trim?.() || error?.message || String(error);
    throw new ValidationError(`Git command failed: ${message}`);
  }
}

/**
 * Get the current commit SHA of a Git repository.
 */
async function getCurrentCommitSha(repoPath: string): Promise<string> {
  const fullSha = await runGit(['rev-parse', 'HEAD'], repoPath);
  return fullSha.substring(0, 7);
}

/**
 * Resolve a ref to a commit SHA using ls-remote (without cloning).
 * Returns the 7-char short SHA or null if resolution fails.
 * 
 * When ref is undefined or 'HEAD', resolves the default branch.
 */
async function resolveRefWithLsRemote(url: string, ref?: string): Promise<string | null> {
  try {
    const targetRef = ref || 'HEAD';
    const output = await runGit(['ls-remote', url, targetRef]);
    if (!output) {
      return null;
    }
    const match = output.match(/^([0-9a-f]{40})\s/i);
    return match ? match[1].substring(0, 7) : null;
  } catch {
    return null;
  }
}

const SEMVER_TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+].*)?$/;

/**
 * Check if a ref is immutable (full SHA or semver tag).
 * Immutable refs never change, so we can trust cached mappings forever.
 */
function isImmutableRef(ref: string): boolean {
  return isFullSha(ref) || SEMVER_TAG_PATTERN.test(ref);
}

/**
 * Clone a Git repository to the structured cache.
 * Uses shallow clones (--depth 1) for space efficiency.
 * 
 * Cache structure:
 * ~/.openpackage/cache/git/<url-hash>/<commit-sha-7>/
 * 
 * Returns the path to the cloned repository (or subdir if specified).
 */
export async function cloneRepoToCache(options: GitCloneOptions): Promise<GitCloneResult> {
  const { url, ref, subdir, skipCache } = options;
  
  // Format URL for display (extract repo name from URL)
  const getDisplayUrl = () => {
    const match = url.match(/([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : url;
  };
  
  // Helper to check cache and return result if hit
  const tryCache = async (shortSha: string, source: string): Promise<GitCloneResult | null> => {
    if (await isCommitCached(url, shortSha)) {
      const commitDir = getGitCommitCacheDir(url, shortSha);
      await touchCacheEntry(commitDir);
      const finalPath = subdir ? join(commitDir, subdir) : commitDir;
      if (!subdir || await exists(finalPath)) {
        logger.debug(`Using cached commit (${source})`, { url, ref, commit: shortSha });
        // Show cache hit to user
        const refDisplay = ref ? `#${ref}` : '';
        const subdirDisplay = subdir ? `/${subdir}` : '';
        console.log(`✓ Using cached ${getDisplayUrl()}${refDisplay}${subdirDisplay} [${shortSha}]`);
        return { path: finalPath, commitSha: shortSha, repoPath: commitDir };
      }
    }
    return null;
  };
  
  // CACHE CHECK: Skip if skipCache is set (--remote flag forces fresh fetch)
  if (!skipCache) {
    // Case 1: Full SHA provided - check cache directly (no network needed)
    if (ref && isFullSha(ref)) {
      const shortSha = ref.substring(0, 7);
      const cached = await tryCache(shortSha, 'full SHA');
      if (cached) return cached;
    }
    
    // Case 2: Immutable ref (semver tag) - trust ref cache without TTL
    if (ref && isImmutableRef(ref) && !isFullSha(ref)) {
      const cachedCommit = await cacheManager.getCachedCommitForRef(url, ref);
      if (cachedCommit) {
        const cached = await tryCache(cachedCommit, 'immutable ref cache');
        if (cached) return cached;
      }
    }
    
    // Case 3: Mutable ref (branch) or no ref (default branch)
    // Always do ls-remote to get current SHA, then check cache
    // This is the key fix: we now handle ref === undefined
    const refDisplay = ref ? `#${ref}` : '';
    const spinner = new Spinner(`Checking ${getDisplayUrl()}${refDisplay}`);
    spinner.start();
    
    const resolvedSha = await resolveRefWithLsRemote(url, ref);
    spinner.stop();
    
    if (resolvedSha) {
      // Update ref cache for future lookups
      if (ref) {
        await cacheManager.cacheRefCommit(url, ref, resolvedSha);
      }
      
      const cached = await tryCache(resolvedSha, 'ls-remote');
      if (cached) return cached;
      
      // SHA resolved but not cached - will need to clone
      logger.debug('Commit not cached, will clone', { url, ref, resolvedSha });
    }
  }
  
  // Clone to a temporary commit directory (we'll get the actual SHA after cloning)
  const repoDir = getGitRepoCacheDir(url);
  await ensureDir(repoDir);
  
  // Write repo metadata
  await writeRepoMetadata(repoDir, {
    url,
    normalized: url.toLowerCase(),
    lastFetched: new Date().toISOString()
  });
  
  // Create a unique temporary clone location.
  // IMPORTANT: recursive dependency resolution may clone multiple resources from the same repo in parallel.
  // A fixed temp dir causes collisions ("File exists") and leaves partial clones behind.
  const tempClonePath = join(
    repoDir,
    `.temp-clone-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  );
  
  logger.debug(`Cloning repository to cache`, { url, ref, subdir });
  
  // Create spinner for git operations
  const refDisplay = ref ? `#${ref}` : '';
  const spinner = new Spinner(`Cloning repository from ${url}${refDisplay}`);
  spinner.start();
  
  try {
    // Clone repository
    if (ref && isSha(ref)) {
      // SHA: shallow clone default branch, then fetch the sha
      await runGit(['clone', '--depth', '1', url, tempClonePath]);
      spinner.update(`Fetching commit ${ref}`);
      await runGit(['fetch', '--depth', '1', 'origin', ref], tempClonePath);
      spinner.update(`Checking out commit ${ref}`);
      await runGit(['checkout', ref], tempClonePath);
    } else if (ref) {
      // Branch or tag
      await runGit(['clone', '--depth', '1', '--branch', ref, url, tempClonePath]);
    } else {
      // Default branch
      await runGit(['clone', '--depth', '1', url, tempClonePath]);
    }
    
    // Get the actual commit SHA
    spinner.update('Resolving commit SHA');
    const commitSha = await getCurrentCommitSha(tempClonePath);
    const commitDir = getGitCommitCacheDir(url, commitSha);
    
    // Check if this commit is already cached
    if (await isCommitCached(url, commitSha)) {
      logger.debug(`Commit already cached, using existing`, { commitSha, commitDir });
      
      spinner.stop();
      
      // Clean up temp clone
      await rm(tempClonePath, { recursive: true, force: true });
      
      // Update access time
      await touchCacheEntry(commitDir);
      
      // Validate subdir if specified
      const finalPath = subdir ? join(commitDir, subdir) : commitDir;
      if (subdir && !(await exists(finalPath))) {
        throw new ValidationError(
          `Subdirectory '${subdir}' does not exist in cached repository ${url}`
        );
      }
      
      return {
        path: finalPath,
        commitSha,
        repoPath: commitDir
      };
    }
    
    // Move temp clone to final location.
    // If another parallel clone won the race and created the commitDir, fall back to using the cached copy.
    try {
      await rename(tempClonePath, commitDir);
    } catch (error: any) {
      const code = error?.code as string | undefined;
      if (code === 'EEXIST' || code === 'ENOTEMPTY') {
        // Another process wrote this commit in parallel.
        await rm(tempClonePath, { recursive: true, force: true });
      } else {
        throw error;
      }
    }
    
    logger.debug(`Moved clone to final cache location`, { commitDir });
    
    // If a parallel clone created commitDir, ensure we treat it as cached from here on.
    if (await isCommitCached(url, commitSha)) {
      await touchCacheEntry(commitDir);
    }
    
    // Write commit metadata
    await writeCommitMetadata(commitDir, {
      url,
      commit: commitSha,
      ref,
      subdir,
      clonedAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    });
    
    // Cache the ref→commit mapping for future lookups
    if (ref) {
      await cacheManager.cacheRefCommit(url, ref, commitSha);
    }
    
    // Validate subdir if specified
    const finalPath = subdir ? join(commitDir, subdir) : commitDir;
    if (subdir && !(await exists(finalPath))) {
      throw new ValidationError(
        `Subdirectory '${subdir}' does not exist in cloned repository ${url}`
      );
    }
    
    // Validate that it's an OpenPackage or Claude Code plugin
    const manifestPath = join(finalPath, FILE_PATTERNS.OPENPACKAGE_YML);
    const hasManifest = await exists(manifestPath);
    
    const pluginManifestPath = join(finalPath, DIR_PATTERNS.CLAUDE_PLUGIN, FILE_PATTERNS.PLUGIN_JSON);
    const hasPluginManifest = await exists(pluginManifestPath);
    
    const marketplaceManifestPath = join(finalPath, DIR_PATTERNS.CLAUDE_PLUGIN, FILE_PATTERNS.MARKETPLACE_JSON);
    const hasMarketplaceManifest = await exists(marketplaceManifestPath);
    
    if (!hasManifest && !hasPluginManifest && !hasMarketplaceManifest) {
      // Allow repos that have plugin content directories (agents/, skills/, commands/, hooks/)
      // even without a formal manifest -- enables interactive selection of individual resources
      const hasContent = await hasPluginContent(finalPath);
      if (!hasContent) {
        throw new ValidationError(
          `Cloned repository is not an OpenPackage or Claude Code plugin ` +
          `(missing ${FILE_PATTERNS.OPENPACKAGE_YML}, ${DIR_PATTERNS.CLAUDE_PLUGIN}/${FILE_PATTERNS.PLUGIN_JSON}, or ${DIR_PATTERNS.CLAUDE_PLUGIN}/${FILE_PATTERNS.MARKETPLACE_JSON} ` +
          `at ${subdir ? `subdir '${subdir}'` : 'repository root'})`
        );
      }
    }
    
    spinner.stop();
    
    const refPart = ref ? `#${ref}` : '';
    const subdirPart = subdir ? `&subdirectory=${subdir}` : '';
    logger.info(`Cloned git repository ${url}${refPart}${subdirPart} to cache [${commitSha}]`);
    
    return {
      path: finalPath,
      commitSha,
      repoPath: commitDir
    };
    
  } catch (error) {
    spinner.stop();
    // Clean up temp clone on error
    if (await exists(tempClonePath)) {
      await rm(tempClonePath, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Legacy alias for backward compatibility.
 * @deprecated Use cloneRepoToCache instead.
 */
export async function cloneRepoToTempDir(options: GitCloneOptions): Promise<string> {
  const result = await cloneRepoToCache(options);
  return result.path;
}
