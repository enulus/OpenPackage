import { cloneRepoToTempDir } from '../../utils/git-clone.js';
import { loadPackageFromPath } from './path-package-loader.js';
import type { Package } from '../../types/index.js';

export interface GitPackageLoadOptions {
  url: string;
  ref?: string;
}

export interface GitPackageLoadResult {
  pkg: Package;
  sourcePath: string;
}

export async function loadPackageFromGit(options: GitPackageLoadOptions): Promise<GitPackageLoadResult> {
  const sourcePath = await cloneRepoToTempDir({ url: options.url, ref: options.ref });
  const pkg = await loadPackageFromPath(sourcePath);
  return { pkg, sourcePath };
}
