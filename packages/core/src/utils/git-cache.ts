import { createHash } from 'crypto';
import { join, basename } from 'path';
import { homedir } from 'os';
import { readdir } from 'fs/promises';
import { readTextFile, writeTextFile, exists, ensureDir } from './fs.js';
import { logger } from './logger.js';
import { normalizeGitUrl } from './git-url-parser.js';

/**
 * Metadata stored at repository level.
 */
export interface GitRepoMetadata {
  url: string;
  normalized: string;
  lastFetched?: string;
}

/**
 * Metadata stored at commit level.
 */
export interface GitCommitMetadata {
  url: string;
  commit: string;        // Full commit SHA
  ref?: string;          // Branch/tag name if specified
  subdir?: string;
  clonedAt: string;
  lastAccessed: string;
}

/**
 * Cache entry information.
 */
export interface GitCacheEntry {
  urlHash: string;
  commitSha: string;
  path: string;
  metadata: GitCommitMetadata;
}

/**
 * Compute a hash of a Git URL for cache directory naming.
 * Uses 12 hex characters (48 bits) for short but collision-resistant paths.
 */
export function computeGitUrlHash(url: string): string {
  const normalized = normalizeGitUrl(url);
  const hash = createHash('sha256').update(normalized).digest('hex');
  
  // Use first 12 chars (48 bits)
  return hash.substring(0, 12);
}

/**
 * Get the base cache directory for Git repositories.
 * Returns: ~/.openpackage/cache/git/
 */
export function getGitCacheDir(): string {
  return join(homedir(), '.openpackage', 'cache', 'git');
}

/**
 * Get the cache directory path for a specific repository (by URL).
 * Returns: ~/.openpackage/cache/git/<url-hash>/
 */
export function getGitRepoCacheDir(url: string): string {
  const urlHash = computeGitUrlHash(url);
  const cacheDir = getGitCacheDir();
  return join(cacheDir, urlHash);
}

/**
 * Get the cache directory path for a specific commit.
 * Returns: ~/.openpackage/cache/git/<url-hash>/<commit-sha-7>/
 */
export function getGitCommitCacheDir(url: string, commitSha: string): string {
  const repoDir = getGitRepoCacheDir(url);
  const shortSha = commitSha.substring(0, 7);
  return join(repoDir, shortSha);
}

/**
 * Get the full cache path including subdirectory if specified.
 * Returns: ~/.openpackage/cache/git/<url-hash>/<commit-sha-7>/<subdirectory>/
 */
export function getGitCachePath(
  url: string,
  commitSha: string,
  subdirectory?: string
): string {
  const commitDir = getGitCommitCacheDir(url, commitSha);
  
  if (subdirectory) {
    return join(commitDir, subdirectory);
  }
  
  return commitDir;
}

/**
 * Get metadata file path for a repository.
 */
function getRepoMetadataPath(repoDir: string): string {
  return join(repoDir, '.opkg-repo.json');
}

/**
 * Get metadata file path for a commit.
 */
function getCommitMetadataPath(commitDir: string): string {
  return join(commitDir, '.opkg-commit.json');
}

/**
 * Write repository metadata.
 */
export async function writeRepoMetadata(
  repoDir: string,
  metadata: GitRepoMetadata
): Promise<void> {
  const metaPath = getRepoMetadataPath(repoDir);
  await ensureDir(repoDir);
  await writeTextFile(metaPath, JSON.stringify(metadata, null, 2));
}

/**
 * Read repository metadata.
 */
export async function readRepoMetadata(
  repoDir: string
): Promise<GitRepoMetadata | null> {
  const metaPath = getRepoMetadataPath(repoDir);
  
  if (!(await exists(metaPath))) {
    return null;
  }
  
  try {
    const content = await readTextFile(metaPath);
    return JSON.parse(content);
  } catch (error) {
    logger.warn(`Failed to read repo metadata at ${metaPath}`, { error });
    return null;
  }
}

/**
 * Write commit metadata.
 */
export async function writeCommitMetadata(
  commitDir: string,
  metadata: GitCommitMetadata
): Promise<void> {
  const metaPath = getCommitMetadataPath(commitDir);
  await ensureDir(commitDir);
  await writeTextFile(metaPath, JSON.stringify(metadata, null, 2));
}

/**
 * Read commit metadata.
 */
export async function readCommitMetadata(
  commitDir: string
): Promise<GitCommitMetadata | null> {
  const metaPath = getCommitMetadataPath(commitDir);
  
  if (!(await exists(metaPath))) {
    return null;
  }
  
  try {
    const content = await readTextFile(metaPath);
    return JSON.parse(content);
  } catch (error) {
    logger.warn(`Failed to read commit metadata at ${metaPath}`, { error });
    return null;
  }
}

/**
 * Update last accessed time for a cached commit.
 */
export async function touchCacheEntry(commitDir: string): Promise<void> {
  const metadata = await readCommitMetadata(commitDir);
  
  if (metadata) {
    metadata.lastAccessed = new Date().toISOString();
    await writeCommitMetadata(commitDir, metadata);
  }
}

/**
 * Check if a commit is already cached.
 */
export async function isCommitCached(url: string, commitSha: string): Promise<boolean> {
  const commitDir = getGitCommitCacheDir(url, commitSha);
  return await exists(commitDir);
}

/**
 * List all cached commits for a repository.
 */
export async function listRepoCachedCommits(url: string): Promise<GitCacheEntry[]> {
  const repoDir = getGitRepoCacheDir(url);
  
  if (!(await exists(repoDir))) {
    return [];
  }
  
  const entries: GitCacheEntry[] = [];
  
  try {
    const items = await readdir(repoDir);
    
    for (const item of items) {
      // Skip metadata files
      if (item.startsWith('.opkg-')) {
        continue;
      }
      
      const commitDir = join(repoDir, item);
      const metadata = await readCommitMetadata(commitDir);
      
      if (metadata) {
        const urlHash = basename(repoDir);
        entries.push({
          urlHash,
          commitSha: item,
          path: commitDir,
          metadata
        });
      }
    }
  } catch (error) {
    logger.warn(`Failed to list cached commits for ${url}`, { error });
  }
  
  return entries;
}

/**
 * List all cached Git repositories.
 */
export async function listAllCachedRepos(): Promise<{
  urlHash: string;
  path: string;
  metadata: GitRepoMetadata | null;
  commits: GitCacheEntry[];
}[]> {
  const cacheDir = getGitCacheDir();
  
  if (!(await exists(cacheDir))) {
    return [];
  }
  
  const repos: {
    urlHash: string;
    path: string;
    metadata: GitRepoMetadata | null;
    commits: GitCacheEntry[];
  }[] = [];
  
  try {
    const items = await readdir(cacheDir);
    
    for (const urlHash of items) {
      const repoDir = join(cacheDir, urlHash);
      const metadata = await readRepoMetadata(repoDir);
      
      // Get all commits for this repo
      const commits = metadata ? await listRepoCachedCommits(metadata.url) : [];
      
      repos.push({
        urlHash,
        path: repoDir,
        metadata,
        commits
      });
    }
  } catch (error) {
    logger.warn(`Failed to list cached repos`, { error });
  }
  
  return repos;
}
