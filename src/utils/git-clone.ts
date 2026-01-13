import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { rm, rename } from 'fs/promises';

import { logger } from './logger.js';
import { ValidationError } from './errors.js';
import { exists, ensureDir } from './fs.js';
import { DIR_PATTERNS, FILE_PATTERNS } from '../constants/index.js';
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

const execFileAsync = promisify(execFile);

export interface GitCloneOptions {
  url: string;
  ref?: string; // branch/tag/sha
  subdirectory?: string; // subdirectory within repository
}

export interface GitCloneResult {
  path: string;         // Full path to clone (including subdirectory if specified)
  commitSha: string;    // Resolved commit SHA (7 chars)
  repoPath: string;     // Path to repository root
}

function isSha(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref);
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
 * Clone a Git repository to the structured cache.
 * Uses shallow clones (--depth 1) for space efficiency.
 * 
 * Cache structure:
 * ~/.openpackage/cache/git/<url-hash>/<commit-sha-7>/
 * 
 * Returns the path to the cloned repository (or subdirectory if specified).
 */
export async function cloneRepoToCache(options: GitCloneOptions): Promise<GitCloneResult> {
  const { url, ref, subdirectory } = options;
  
  // Clone to a temporary commit directory (we'll get the actual SHA after cloning)
  const repoDir = getGitRepoCacheDir(url);
  await ensureDir(repoDir);
  
  // Write repo metadata
  await writeRepoMetadata(repoDir, {
    url,
    normalized: url.toLowerCase(),
    lastFetched: new Date().toISOString()
  });
  
  // Create a temporary clone location
  const tempClonePath = join(repoDir, '.temp-clone');
  
  // Remove temp location if it exists from a previous failed clone
  if (await exists(tempClonePath)) {
    await rm(tempClonePath, { recursive: true, force: true });
  }
  
  logger.debug(`Cloning repository to cache`, { url, ref, subdirectory });
  
  try {
    // Clone repository
    if (ref && isSha(ref)) {
      // SHA: shallow clone default branch, then fetch the sha
      await runGit(['clone', '--depth', '1', url, tempClonePath]);
      await runGit(['fetch', '--depth', '1', 'origin', ref], tempClonePath);
      await runGit(['checkout', ref], tempClonePath);
    } else if (ref) {
      // Branch or tag
      await runGit(['clone', '--depth', '1', '--branch', ref, url, tempClonePath]);
    } else {
      // Default branch
      await runGit(['clone', '--depth', '1', url, tempClonePath]);
    }
    
    // Get the actual commit SHA
    const commitSha = await getCurrentCommitSha(tempClonePath);
    const commitDir = getGitCommitCacheDir(url, commitSha);
    
    // Check if this commit is already cached
    if (await isCommitCached(url, commitSha)) {
      logger.debug(`Commit already cached, using existing`, { commitSha, commitDir });
      
      // Clean up temp clone
      await rm(tempClonePath, { recursive: true, force: true });
      
      // Update access time
      await touchCacheEntry(commitDir);
      
      // Validate subdirectory if specified
      const finalPath = subdirectory ? join(commitDir, subdirectory) : commitDir;
      if (subdirectory && !(await exists(finalPath))) {
        throw new ValidationError(
          `Subdirectory '${subdirectory}' does not exist in cached repository ${url}`
        );
      }
      
      return {
        path: finalPath,
        commitSha,
        repoPath: commitDir
      };
    }
    
    // Move temp clone to final location
    await rename(tempClonePath, commitDir);
    
    logger.debug(`Moved clone to final cache location`, { commitDir });
    
    // Write commit metadata
    await writeCommitMetadata(commitDir, {
      url,
      commit: commitSha,
      ref,
      subdirectory,
      clonedAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    });
    
    // Validate subdirectory if specified
    const finalPath = subdirectory ? join(commitDir, subdirectory) : commitDir;
    if (subdirectory && !(await exists(finalPath))) {
      throw new ValidationError(
        `Subdirectory '${subdirectory}' does not exist in cloned repository ${url}`
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
      throw new ValidationError(
        `Cloned repository is not an OpenPackage or Claude Code plugin ` +
        `(missing ${FILE_PATTERNS.OPENPACKAGE_YML}, ${DIR_PATTERNS.CLAUDE_PLUGIN}/${FILE_PATTERNS.PLUGIN_JSON}, or ${DIR_PATTERNS.CLAUDE_PLUGIN}/${FILE_PATTERNS.MARKETPLACE_JSON} ` +
        `at ${subdirectory ? `subdirectory '${subdirectory}'` : 'repository root'})`
      );
    }
    
    const refPart = ref ? `#${ref}` : '';
    const subdirPart = subdirectory ? `&subdirectory=${subdirectory}` : '';
    logger.info(`Cloned git repository ${url}${refPart}${subdirPart} to cache [${commitSha}]`);
    
    return {
      path: finalPath,
      commitSha,
      repoPath: commitDir
    };
    
  } catch (error) {
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
