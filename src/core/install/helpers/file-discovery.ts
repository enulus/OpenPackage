import { packageManager } from '../../package.js';
import { FILE_PATTERNS, PACKAGE_PATHS } from '../../../constants/index.js';
import type { PackageFile } from '../../../types/index.js';
import { getPlatformDefinition, type Platform } from '../../platforms.js';
import { buildNormalizedIncludeSet, isManifestPath, normalizePackagePath } from '../../../utils/manifest-paths.js';
import { getPlatformRootFileNames, stripRootCopyPrefix, isRootCopyPath } from '../../../utils/platform-root-files.js';
import { loadPackageFromPath } from '../path-package-loader.js';

export interface CategorizedInstallFiles {
  pathBasedFiles: PackageFile[];
  rootFiles: Map<string, string>;
  rootCopyFiles: PackageFile[];
}

export async function discoverAndCategorizeFiles(
  packageName: string,
  version: string,
  platforms: Platform[],
  includePaths?: string[],
  contentRoot?: string,
  contentFilter?: string,
  contentType?: 'skills' | 'agents'
): Promise<CategorizedInstallFiles> {
  // For content-filter installs, ensure we re-load using the same filter/type.
  // Otherwise we may accidentally treat the directory as a skills collection.
  const pkg =
    contentRoot && (contentFilter || contentType)
      ? await loadPackageFromPath(contentRoot, { packageName, contentFilter, contentType })
      : await packageManager.loadPackage(packageName, version, { packageRootDir: contentRoot });

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


