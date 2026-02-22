import { join } from 'path';
import { DIR_PATTERNS, FILE_PATTERNS, OPENPACKAGE_DIRS } from '../constants/index.js';
import { DEFAULT_INSTALL_ROOT } from '../constants/workspace.js';
import { exists } from './fs.js';
import { arePackageNamesEquivalent, SCOPED_PACKAGE_REGEX } from './package-name.js';
import { parsePackageYml } from './package-yml.js';

/**
 * Path utility functions for consistent file and directory path handling
 * across the OpenPackage CLI application.
 */

/**
 * Get the path to the workspace manifest (openpackage.yml)
 */
export function getLocalPackageYmlPath(targetDir: string): string {
  return join(targetDir, DIR_PATTERNS.OPENPACKAGE, FILE_PATTERNS.OPENPACKAGE_YML);
}

/**
 * Check if a package name matches the root package in .openpackage/openpackage.yml
 */
export async function isRootPackage(targetDir: string, packageName: string): Promise<boolean> {
  const rootPackageYmlPath = getLocalPackageYmlPath(targetDir);
  if (!(await exists(rootPackageYmlPath))) {
    return false;
  }
  
  try {
    const config = await parsePackageYml(rootPackageYmlPath);
    return arePackageNamesEquivalent(config.name, packageName);
  } catch (error) {
    return false;
  }
}

/**
 * Get the local OpenPackage directory path
 */
export function getLocalOpenPackageDir(targetDir: string): string {
  return join(targetDir, DIR_PATTERNS.OPENPACKAGE);
}

/**
 * Get the local packages directory path
 */
export function getLocalPackagesDir(targetDir: string): string {
  return join(targetDir, DIR_PATTERNS.OPENPACKAGE, OPENPACKAGE_DIRS.PACKAGES);
}

/**
 * Get the local package directory path for a specific package
 * Handles scoped packages with nested directory structure (@scope/name -> @scope/name/)
 */
export function getLocalPackageDir(targetDir: string, packageName: string): string {
  const scopedMatch = packageName.match(SCOPED_PACKAGE_REGEX);
  if (scopedMatch) {
    const [, scope, localName] = scopedMatch;
    return join(targetDir, DIR_PATTERNS.OPENPACKAGE, OPENPACKAGE_DIRS.PACKAGES, '@' + scope, localName);
  }
  return join(targetDir, DIR_PATTERNS.OPENPACKAGE, OPENPACKAGE_DIRS.PACKAGES, packageName);
}

/**
 * Get the cached package root directory for a specific package.
 * Cached copies mirror the package payload at their root.
 */
export function getLocalPackageContentDir(targetDir: string, packageName: string): string {
  return getLocalPackageDir(targetDir, packageName);
}

/**
 * Get the default workspace install root path
 */
export function getInstallRootDir(targetDir: string): string {
  return join(targetDir, DEFAULT_INSTALL_ROOT);
}

