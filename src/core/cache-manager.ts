import { homedir } from 'os';
import { join } from 'path';
import { exists, ensureDir, readTextFile, writeTextFile } from '../utils/fs.js';
import { computeGitUrlHash } from '../utils/git-cache.js';
import { logger } from '../utils/logger.js';
import { getPackageVersionPath } from './directory.js';

const METADATA_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface CachedRefEntry {
  commit: string;
  fetchedAt: string;
}

export interface GitRefCache {
  refs: Record<string, CachedRefEntry>;
}

export interface CachedMetadata {
  versions: string[];
  fetchedAt: string;
  etag?: string;
}

export interface CacheManager {
  getCachedCommitForRef(url: string, ref: string): Promise<string | null>;
  cacheRefCommit(url: string, ref: string, commit: string): Promise<void>;

  getLocalPackagePath(name: string, version: string): Promise<string | null>;
  hasLocalPackage(name: string, version: string): Promise<boolean>;

  getCachedMetadata(name: string): Promise<CachedMetadata | null>;
  cacheMetadata(name: string, versions: string[], etag?: string): Promise<void>;
}

function getGitRefsCacheDir(): string {
  return join(homedir(), '.openpackage', 'cache', 'git-refs');
}

function getMetadataCacheDir(): string {
  return join(homedir(), '.openpackage', 'cache', 'metadata');
}

function getGitRefCachePath(url: string): string {
  const urlHash = computeGitUrlHash(url);
  return join(getGitRefsCacheDir(), `${urlHash}.json`);
}

function getMetadataCachePath(name: string): string {
  const safeName = name.replace(/\//g, '__');
  return join(getMetadataCacheDir(), `${safeName}.json`);
}

function isExpired(fetchedAt: string, ttlMs: number): boolean {
  const fetchedTime = new Date(fetchedAt).getTime();
  return Date.now() - fetchedTime > ttlMs;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!(await exists(filePath))) {
    return null;
  }

  try {
    const content = await readTextFile(filePath);
    return JSON.parse(content);
  } catch (error) {
    logger.warn(`Failed to read cache file at ${filePath}`, { error });
    return null;
  }
}

async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  const dir = join(filePath, '..');
  await ensureDir(dir);
  await writeTextFile(filePath, JSON.stringify(data, null, 2));
}

export function createCacheManager(): CacheManager {
  return {
    async getCachedCommitForRef(url: string, ref: string): Promise<string | null> {
      const cachePath = getGitRefCachePath(url);
      const cache = await readJsonFile<GitRefCache>(cachePath);

      if (!cache?.refs?.[ref]) {
        return null;
      }

      // Return cached commit - caller decides whether to trust based on ref immutability
      // (git-clone.ts only uses this for immutable refs like semver tags)
      return cache.refs[ref].commit;
    },

    async cacheRefCommit(url: string, ref: string, commit: string): Promise<void> {
      const cachePath = getGitRefCachePath(url);
      let cache = await readJsonFile<GitRefCache>(cachePath);

      if (!cache) {
        cache = { refs: {} };
      }

      cache.refs[ref] = {
        commit,
        fetchedAt: new Date().toISOString(),
      };

      await writeJsonFile(cachePath, cache);
      logger.debug(`Cached git ref ${ref} -> ${commit.substring(0, 7)}`, { url });
    },

    async getLocalPackagePath(name: string, version: string): Promise<string | null> {
      const packagePath = getPackageVersionPath(name, version);

      if (await exists(packagePath)) {
        return packagePath;
      }

      return null;
    },

    async hasLocalPackage(name: string, version: string): Promise<boolean> {
      const packagePath = getPackageVersionPath(name, version);
      return await exists(packagePath);
    },

    async getCachedMetadata(name: string): Promise<CachedMetadata | null> {
      const cachePath = getMetadataCachePath(name);
      const cache = await readJsonFile<CachedMetadata>(cachePath);

      if (!cache) {
        return null;
      }

      if (isExpired(cache.fetchedAt, METADATA_TTL_MS)) {
        logger.debug(`Metadata cache expired for ${name}`, { fetchedAt: cache.fetchedAt });
        return null;
      }

      return cache;
    },

    async cacheMetadata(name: string, versions: string[], etag?: string): Promise<void> {
      const cachePath = getMetadataCachePath(name);

      const cache: CachedMetadata = {
        versions,
        fetchedAt: new Date().toISOString(),
        ...(etag && { etag }),
      };

      await writeJsonFile(cachePath, cache);
      logger.debug(`Cached metadata for ${name}`, { versionCount: versions.length });
    },
  };
}
