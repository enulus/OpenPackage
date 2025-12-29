import { packageManager } from '../core/package.js';
import { FILE_PATTERNS, PACKAGE_PATHS } from '../constants/index.js';
import type { PackageFile } from '../types/index.js';
import { getPlatformDefinition, type Platform } from '../core/platforms.js';
import { buildNormalizedIncludeSet, isManifestPath, normalizePackagePath } from './manifest-paths.js';
import { getPlatformRootFileNames, stripRootCopyPrefix, isRootCopyPath } from './platform-root-files.js';

export interface CategorizedInstallFiles {
  pathBasedFiles: PackageFile[];
  rootFiles: Map<string, string>;
  rootCopyFiles: PackageFile[];
}

export async function discoverAndCategorizeFiles(
  packageName: string,
  version: string,
  platforms: Platform[],
  includePaths?: string[]
): Promise<CategorizedInstallFiles> {
  // Load once
  const pkg = await packageManager.loadPackage(packageName, version);

  const normalizedIncludes = buildNormalizedIncludeSet(includePaths);

  const shouldInclude = (path: string): boolean =>
    !normalizedIncludes || normalizedIncludes.has(normalizePackagePath(path));

  // Precompute platform root filenames
  const platformRootNames = getPlatformRootFileNames(platforms);

  // Single pass classification
  const pathBasedFiles: PackageFile[] = [];
  const rootFiles = new Map<string, string>();
  const rootCopyFiles: PackageFile[] = [];
  for (const file of pkg.files) {
    const p = file.path;
    const normalized = normalizePackagePath(p);
    // Never install registry package metadata files
    if (isManifestPath(p) || normalized === PACKAGE_PATHS.INDEX_RELATIVE) continue;
    if (!shouldInclude(p)) continue;

    // root/** copy-to-root handling
    const stripped = stripRootCopyPrefix(normalized);
    if (stripped !== null) {
      rootCopyFiles.push({ ...file, path: stripped });
      continue;
    }

    pathBasedFiles.push(file);

    if (normalized === FILE_PATTERNS.AGENTS_MD || platformRootNames.has(normalized)) {
      rootFiles.set(normalized, file.content);
    }
  }

  return { pathBasedFiles, rootFiles, rootCopyFiles };
}


