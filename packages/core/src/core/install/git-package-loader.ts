import { cloneRepoToCache } from '../../utils/git-clone.js';
import { loadPackageFromPath } from './path-package-loader.js';
import { detectPluginType } from './plugin-detector.js';
import type { Package } from '../../types/index.js';

export interface GitPackageLoadOptions {
  url: string;
  ref?: string;
  path?: string;
  resourcePath?: string;
  skipCache?: boolean; // Force fresh clone (for --remote flag)
}

export interface GitPackageLoadResult {
  pkg: Package | null;
  sourcePath: string;
  repoPath: string;
  commitSha: string;
  isMarketplace: boolean;
}

export async function loadPackageFromGit(options: GitPackageLoadOptions): Promise<GitPackageLoadResult> {
  const cloneResult = await cloneRepoToCache({ 
    url: options.url, 
    ref: options.ref,
    subdir: options.path,
    skipCache: options.skipCache
  });
  
  const { path: sourcePath, repoPath, commitSha } = cloneResult;
  
  // If the caller provided a resourcePath, we must NOT treat a repo-root marketplace
  // as "install a marketplace" yet. The upper layer will detect base from the resource path
  // and then load the specific plugin/package base (avoids marketplace selection prompt).
  if (options.resourcePath) {
    return {
      pkg: null,
      sourcePath,
      repoPath,
      commitSha,
      isMarketplace: false
    };
  }

  // Check if this is a marketplace first - marketplaces don't have openpackage.yml
  // and need to be handled differently
  const pluginDetection = await detectPluginType(sourcePath);
  if (pluginDetection.isPlugin && pluginDetection.type === 'marketplace') {
    return { 
      pkg: null, 
      sourcePath, 
      repoPath,
      commitSha,
      isMarketplace: true 
    };
  }
  
  // Not a marketplace, load as regular package or individual plugin
  // Pass GitHub context for scoped naming
  const pkg = await loadPackageFromPath(sourcePath, {
    gitUrl: options.url,
    path: options.path,
    resourcePath: options.resourcePath,
    repoPath
  });
  
  return { 
    pkg, 
    sourcePath, 
    repoPath,
    commitSha,
    isMarketplace: false 
  };
}
