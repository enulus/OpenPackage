/**
 * Shared cache for content roots during wave resolution.
 * Ensures the wave-engine and fetchers don't duplicate git loads.
 */

import { join } from 'path';
import { loadPackageFromGit } from '../git-package-loader.js';
import type { ResolvedSource } from './types.js';

export interface ContentRootResult {
  contentRoot: string | undefined;
  isMarketplace: boolean;
  repoPath?: string;
  commitSha?: string;
}

const contentRootCache = new Map<string, ContentRootResult>();

/**
 * Generate a cache key for a git source.
 */
function getCacheKey(source: ResolvedSource): string {
  if (source.type !== 'git') {
    throw new Error('getCacheKey only supports git sources');
  }
  return `${source.gitUrl}#${source.gitRef ?? 'default'}#${source.resourcePath ?? ''}`;
}

export interface EnsureContentRootOptions {
  skipCache?: boolean;
}

/**
 * Ensure content root is loaded for a git source, using cache.
 * Returns undefined contentRoot if load fails.
 */
export async function ensureContentRoot(
  source: ResolvedSource,
  options: EnsureContentRootOptions = {}
): Promise<ContentRootResult> {
  if (source.type !== 'git') {
    return {
      contentRoot: source.contentRoot ?? source.absolutePath,
      isMarketplace: false
    };
  }

  const key = getCacheKey(source);
  
  // Skip in-memory cache if skipCache is set (forces fresh git fetch)
  if (!options.skipCache) {
    const cached = contentRootCache.get(key);
    if (cached) {
      return cached;
    }
  }

  try {
    const result = await loadPackageFromGit({
      url: source.gitUrl!,
      ref: source.gitRef,
      path: undefined,
      resourcePath: source.resourcePath,
      skipCache: options.skipCache
    });

    const contentRoot = source.resourcePath
      ? join(result.sourcePath, source.resourcePath)
      : result.sourcePath;

    const cacheResult: ContentRootResult = {
      contentRoot: result.isMarketplace ? undefined : contentRoot,
      isMarketplace: result.isMarketplace,
      repoPath: result.repoPath,
      commitSha: result.commitSha
    };

    contentRootCache.set(key, cacheResult);
    return cacheResult;
  } catch {
    const failResult: ContentRootResult = {
      contentRoot: undefined,
      isMarketplace: false
    };
    contentRootCache.set(key, failResult);
    return failResult;
  }
}

/**
 * Clear the content root cache (for tests).
 */
export function clearContentRootCache(): void {
  contentRootCache.clear();
}
