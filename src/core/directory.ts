import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import { OpenPackageDirectories } from '../types/index.js';
import { DIR_PATTERNS, OPENPACKAGE_DIRS, UNVERSIONED } from '../constants/index.js';
import { ensureDir, exists, listDirectories, remove } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { normalizePackageName } from '../utils/package-name.js';

/**
 * Cross-platform directory resolution following platform conventions
 */

/**
 * Get OpenPackage directories using unified dotfile convention
 * Uses ~/.openpackage on all platforms for consistency (like AWS CLI with ~/.aws)
 * This approach prioritizes simplicity and cross-platform consistency
 */
export function getOpenPackageDirectories(): OpenPackageDirectories {
  const homeDir = os.homedir();
  const openPackageDir = path.join(homeDir, DIR_PATTERNS.OPENPACKAGE);
  
  return {
    config: openPackageDir,
    data: openPackageDir,  // Same directory - follows dotfile convention
    cache: path.join(openPackageDir, OPENPACKAGE_DIRS.CACHE),
    runtime: path.join(os.tmpdir(), 'openpackage')
  };
}

/**
 * Ensure all OpenPackage directories exist
 */
export async function ensureOpenPackageDirectories(): Promise<OpenPackageDirectories> {
  const openPackageDirs = getOpenPackageDirectories();
  
  try {
    await Promise.all([
      ensureDir(openPackageDirs.config),
      ensureDir(openPackageDirs.data),
      ensureDir(openPackageDirs.cache),
      ensureDir(openPackageDirs.runtime)
    ]);
    
    logger.debug('OpenPackage directories ensured', { directories: openPackageDirs });
    return openPackageDirs;
  } catch (error) {
    logger.error('Failed to create OpenPackage directories', { error, directories: openPackageDirs });
    throw error;
  }
}

/**
 * Get the registry directories
 */
export function getRegistryDirectories(): { packages: string } {
  const openPackageDirs = getOpenPackageDirectories();
  const registryDir = path.join(openPackageDirs.data, OPENPACKAGE_DIRS.REGISTRY);

  return {
    packages: registryDir
  };
}

/**
 * Ensure registry directories exist
 */
export async function ensureRegistryDirectories(): Promise<{ packages: string }> {
  const dirs = getRegistryDirectories();
  
  try {
    await ensureDir(dirs.packages);
    
    logger.debug('Registry directories ensured', { directories: dirs });
    return dirs;
  } catch (error) {
    logger.error('Failed to create registry directories', { error, directories: dirs });
    throw error;
  }
}

/**
 * Get the cache directory for a specific type of cache
 */
export function getCacheDirectory(cacheType: string): string {
  const openPackageDirs = getOpenPackageDirectories();
  return path.join(openPackageDirs.cache, cacheType);
}

/**
 * Get the temporary directory for a specific operation
 */
export function getTempDirectory(operation: string): string {
  const openPackageDirs = getOpenPackageDirectories();
  return path.join(openPackageDirs.runtime, operation);
}

/**
 * Get the base path for a package (contains all versions)
 * Package names are normalized to lowercase for consistent registry paths.
 */
export function getPackagePath(packageName: string): string {
  const dirs = getRegistryDirectories();
  const normalizedName = normalizePackageName(packageName);
  return path.join(dirs.packages, normalizedName);
}

/**
 * Get the path for a specific version of a package
 * If version is undefined, return the unversioned path.
 */
export function getPackageVersionPath(packageName: string, version?: string): string {
  const versionSegment = version ?? UNVERSIONED;
  return path.join(getPackagePath(packageName), versionSegment);
}

/**
 * List all versions of a package
 */
export async function listPackageVersions(packageName: string): Promise<string[]> {
  const packagePath = getPackagePath(packageName);
  
  if (!(await exists(packagePath))) {
    return [];
  }
  
  const versions = await listDirectories(packagePath);
  const semverVersions = versions.filter(version => semver.valid(version));
  return semverVersions.sort((a, b) => semver.compare(b, a)); // Latest first
}

/**
 * Get the latest version of a package
 */
export async function getLatestPackageVersion(packageName: string): Promise<string | null> {
  const versions = await listPackageVersions(packageName);
  if (versions.length === 0) {
    return null;
  }
  return versions[0];
}

/**
 * Check if a specific version exists
 */
export async function hasPackageVersion(packageName: string, version?: string): Promise<boolean> {
  const versionPath = getPackageVersionPath(packageName, version);
  return await exists(versionPath);
}

/**
 * Find a package by name, searching case-insensitively across registry directories.
 * Returns the normalized package name if found, null otherwise.
 * If multiple packages match the same normalized name, returns the first one found.
 */
export async function findPackageByName(packageName: string): Promise<string | null> {
  const normalizedTarget = normalizePackageName(packageName);
  const dirs = getRegistryDirectories();

  if (!(await exists(dirs.packages))) {
    return null;
  }

  const packageDirs = await listDirectories(dirs.packages);

  // First try exact normalized match
  if (packageDirs.includes(normalizedTarget)) {
    return normalizedTarget;
  }

  // Then try case-insensitive match
  for (const dirName of packageDirs) {
    if (normalizePackageName(dirName) === normalizedTarget) {
      return dirName; // Return the actual directory name as it exists on disk
    }
  }

  return null;
}

/**
 * List all package base names in the local registry, including scoped packages.
 * Returns names relative to the packages root, e.g. 'name', '@scope/name', or '@scope/name/subname'.
 * Supports arbitrary nesting for hierarchical package names.
 */
export async function listAllPackages(): Promise<string[]> {
  const { packages } = getRegistryDirectories();

  if (!(await exists(packages))) {
    return [];
  }

  const result: string[] = [];

  /**
   * Recursively scan for packages by checking for version directories
   */
  async function scanForPackages(currentPath: string, relativePath: string): Promise<void> {
    const children = await listDirectories(currentPath);

    // Check if this directory contains version directories (is a package)
    const hasVersions = children.some(child => child === UNVERSIONED || semver.valid(child));
    if (hasVersions) {
      result.push(relativePath);
      return; // Don't recurse into version directories
    }

    // Otherwise, recurse into subdirectories
    for (const child of children) {
      const childPath = path.join(currentPath, child);
      const childRelativePath = relativePath ? `${relativePath}/${child}` : child;
      await scanForPackages(childPath, childRelativePath);
    }
  }

  await scanForPackages(packages, '');

  // Stable order
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

/**
 * Clean up empty package directory after all versions are removed
 * Returns true if directory was removed, false if it still has versions
 */
export async function cleanupEmptyPackageDirectory(packageName: string): Promise<boolean> {
  const packagePath = getPackagePath(packageName);
  const versions = await listPackageVersions(packageName);
  
  if (versions.length === 0 && await exists(packagePath)) {
    await remove(packagePath);
    logger.info('Removed empty package directory', { packagePath });
    return true;
  }
  
  return false;
}

