import { cloneRepoToTempDir } from '../../utils/git-clone.js';
import { loadPackageFromPath } from './path-package-loader.js';
import { detectPluginType } from './plugin-detector.js';
import type { Package } from '../../types/index.js';

export interface GitPackageLoadOptions {
  url: string;
  ref?: string;
  subdirectory?: string;
}

export interface GitPackageLoadResult {
  pkg: Package | null;
  sourcePath: string;
  isMarketplace: boolean;
}

export async function loadPackageFromGit(options: GitPackageLoadOptions): Promise<GitPackageLoadResult> {
  const sourcePath = await cloneRepoToTempDir({ 
    url: options.url, 
    ref: options.ref,
    subdirectory: options.subdirectory
  });
  
  // Check if this is a marketplace first - marketplaces don't have openpackage.yml
  // and need to be handled differently
  const pluginDetection = await detectPluginType(sourcePath);
  if (pluginDetection.isPlugin && pluginDetection.type === 'marketplace') {
    return { pkg: null, sourcePath, isMarketplace: true };
  }
  
  // Not a marketplace, load as regular package or individual plugin
  const pkg = await loadPackageFromPath(sourcePath);
  return { pkg, sourcePath, isMarketplace: false };
}
