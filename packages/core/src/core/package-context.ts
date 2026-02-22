/**
 * Unified Package Context
 * 
 * Provides consistent package location resolution for all pipelines.
 * Package payloads store content at the package root alongside openpackage.yml.
 * Cached packages (workspace) live under .openpackage/packages/<name>/ with the same layout.
 */

import { join } from 'path';

import { DIR_PATTERNS, FILE_PATTERNS, OPENPACKAGE_DIRS } from '../constants/index.js';
import type { PackageYml } from '../types/index.js';
import { exists, isDirectory } from '../utils/fs.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { arePackageNamesEquivalent, normalizePackageName } from '../utils/package-name.js';
import { findDirectoriesContainingFile } from '../utils/file-processing.js';
import { logger } from '../utils/logger.js';

/**
 * Package location type
 */
export type PackageLocation = 'root' | 'nested';

/**
 * Unified package context used by all pipelines.
 * 
 * Key distinction:
 * - packageRootDir: the package root directory (content lives directly here)
 * - packageYmlPath: <packageRootDir>/openpackage.yml
 * 
 * For root packages:
 *   packageRootDir = cwd/
 *   packageYmlPath = cwd/openpackage.yml
 * 
 * For cached packages:
 *   packageRootDir = cwd/.openpackage/packages/<name>/
 *   packageYmlPath = cwd/.openpackage/packages/<name>/openpackage.yml
 */
export interface PackageContext {
  /** Normalized package name */
  name: string;
  
  /** Package version from openpackage.yml */
  version?: string;
  
  /** Full config from openpackage.yml */
  config: PackageYml;
  
  /** Absolute path to openpackage.yml */
  packageYmlPath: string;
  
  /** 
   * Absolute path to the package root directory.
   * - Root: <cwd>/
   * - Nested: <cwd>/.openpackage/packages/<name>/
   */
  packageRootDir: string;
  
  /** 
   * Absolute path to the content directory (same as package root for v2 layout)
   */
  packageFilesDir: string;
  
  /** Package location type */
  location: PackageLocation;
  
  /** Whether this is the cwd's own package (root package without explicit name) */
  isCwdPackage: boolean;
  
  /** Whether this package was newly created (for init/add flows) */
  isNew?: boolean;
}

/**
 * Get the package root directory based on location.
 * - Root: cwd/
 * - Nested: cwd/.openpackage/packages/<name>/
 */
export function getPackageRootDir(cwd: string, location: PackageLocation, packageName?: string): string {
  if (location === 'root') {
    return cwd;
  }
  
  if (!packageName) {
    throw new Error('Package name required for nested packages');
  }
  
  return join(cwd, DIR_PATTERNS.OPENPACKAGE, OPENPACKAGE_DIRS.PACKAGES, normalizePackageName(packageName));
}

/**
 * Get the package content directory (v2 layout: same as the package root).
 */
export function getPackageFilesDir(cwd: string, location: PackageLocation, packageName?: string): string {
  // In v2, content lives at the package root.
  return getPackageRootDir(cwd, location, packageName);
}

/**
 * Get the openpackage.yml path based on location.
 */
export function getPackageYmlPath(cwd: string, location: PackageLocation, packageName?: string): string {
  const contentDir = getPackageRootDir(cwd, location, packageName);
  return join(contentDir, FILE_PATTERNS.OPENPACKAGE_YML);
}

/**
 * Core rule: any directory that contains `openpackage.yml` is a valid package.
 */
export async function isValidPackageDirectory(dir: string): Promise<boolean> {
  const packageYmlPath = join(dir, FILE_PATTERNS.OPENPACKAGE_YML);
  return exists(packageYmlPath);
}

/**
 * Load package config from a directory that satisfies the core rule.
 */
export async function loadPackageConfig(dir: string): Promise<PackageYml | null> {
  const packageYmlPath = join(dir, FILE_PATTERNS.OPENPACKAGE_YML);
  if (!(await exists(packageYmlPath))) {
    return null;
  }

  try {
    return await parsePackageYml(packageYmlPath);
  } catch (error) {
    logger.debug(`Failed to parse openpackage.yml at ${packageYmlPath}: ${error}`);
    return null;
  }
}

/**
 * Detect package context for any pipeline operation.
 * 
 * Resolution order:
 * 1. No packageName provided → target cwd as root package
 * 2. packageName matches root package name → root package
 * 3. packageName found in nested packages → nested package
 * 4. packageName not found → null (caller decides: error or create)
 */
export async function detectPackageContext(
  cwd: string,
  packageName?: string
): Promise<PackageContext | null> {
  const rootPackageYmlPath = getPackageYmlPath(cwd, 'root');
  const hasRootPackage = await exists(rootPackageYmlPath);

  // No package name provided: target cwd as the package itself
  if (!packageName) {
    if (!hasRootPackage) {
      return null;
    }

    try {
      const config = await parsePackageYml(rootPackageYmlPath);
      return {
        name: normalizePackageName(config.name),
        version: config.version,
        config,
        packageYmlPath: rootPackageYmlPath,
        packageRootDir: getPackageRootDir(cwd, 'root'),
        packageFilesDir: getPackageFilesDir(cwd, 'root'),
        location: 'root',
        isCwdPackage: true
      };
    } catch (error) {
      logger.warn(`Failed to parse root openpackage.yml: ${error}`);
      return null;
    }
  }

  const normalizedName = normalizePackageName(packageName);

  // Package name provided: check if it matches root package
  if (hasRootPackage) {
    try {
      const rootConfig = await parsePackageYml(rootPackageYmlPath);
      if (arePackageNamesEquivalent(rootConfig.name, packageName)) {
        return {
          name: normalizedName,
          version: rootConfig.version,
          config: rootConfig,
          packageYmlPath: rootPackageYmlPath,
          packageRootDir: getPackageRootDir(cwd, 'root'),
          packageFilesDir: getPackageFilesDir(cwd, 'root'),
          location: 'root',
          isCwdPackage: true
        };
      }
    } catch (error) {
      logger.debug(`Failed to parse root openpackage.yml: ${error}`);
    }
  }

  // Check nested packages directory
  // Check cached packages directory for a matching package name
  const packagesDir = join(cwd, DIR_PATTERNS.OPENPACKAGE, OPENPACKAGE_DIRS.PACKAGES);
  if (await exists(packagesDir) && (await isDirectory(packagesDir))) {
    try {
      // Direct match on expected path
      const nestedPackageRootDir = getPackageRootDir(cwd, 'nested', packageName);
      const nestedPackageYmlPath = getPackageYmlPath(cwd, 'nested', packageName);

      if (await exists(nestedPackageYmlPath)) {
        const nestedConfig = await parsePackageYml(nestedPackageYmlPath);
        if (arePackageNamesEquivalent(nestedConfig.name, packageName)) {
          return {
            name: normalizedName,
            version: nestedConfig.version,
            config: nestedConfig,
            packageYmlPath: nestedPackageYmlPath,
            packageRootDir: nestedPackageRootDir,
            packageFilesDir: nestedPackageRootDir,
            location: 'nested',
            isCwdPackage: false
          };
        }
      }

      // Fallback: scan for mismatched directory name
      const packageDirs = await findDirectoriesContainingFile(
        packagesDir,
        FILE_PATTERNS.OPENPACKAGE_YML,
        async filePath => {
          try {
            return await parsePackageYml(filePath);
          } catch {
            return null;
          }
        }
      );

      for (const { dirPath, parsedContent } of packageDirs) {
        if (!parsedContent) continue;

        if (arePackageNamesEquivalent(parsedContent.name, packageName)) {
          // dirPath is the package root containing openpackage.yml
          const packageRootDir = dirPath;
          return {
            name: normalizedName,
            version: parsedContent.version,
            config: parsedContent,
            packageYmlPath: join(dirPath, FILE_PATTERNS.OPENPACKAGE_YML),
            packageRootDir,
            packageFilesDir: packageRootDir,
            location: 'nested',
            isCwdPackage: false
          };
        }
      }
    } catch (error) {
      logger.debug(`Failed to scan packages directory: ${error}`);
    }
  }

  return null;
}

/**
 * Create a new package context for initialization.
 * Does not write any files - just builds the context.
 */
export function createPackageContext(
  cwd: string,
  config: PackageYml,
  location: PackageLocation
): PackageContext {
  const normalizedName = normalizePackageName(config.name);
  
  return {
    name: normalizedName,
    version: config.version,
    config,
    packageYmlPath: getPackageYmlPath(cwd, location, location === 'nested' ? normalizedName : undefined),
    packageRootDir: getPackageRootDir(cwd, location, location === 'nested' ? normalizedName : undefined),
    packageFilesDir: getPackageFilesDir(cwd, location, location === 'nested' ? normalizedName : undefined),
    location,
    isCwdPackage: location === 'root',
    isNew: true
  };
}

/**
 * Check if a package context represents a root package.
 */
export function isRootPackage(ctx: PackageContext): boolean {
  return ctx.location === 'root';
}

/**
 * Error message for when no package is detected.
 */
export function getNoPackageDetectedMessage(packageName?: string): string {
  if (packageName) {
    return (
      `Package '${packageName}' not found.\n\n` +
      `Checked locations:\n` +
      `  • Root package: openpackage.yml\n` +
      `  • Cached packages: .openpackage/packages/${packageName}/\n\n` +
      `💡 To install a package, run: opkg install ${packageName}`
    );
  }

  return (
    `No package detected at current directory.\n\n` +
    `A valid package requires openpackage.yml to exist.\n\n` +
    `💡 To create a package:\n` +
    `   • Run 'opkg new' to create a new package`
  );
}

