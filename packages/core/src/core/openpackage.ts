import { join } from 'path';
import { PackageYml, PackageDependency } from '../types/index.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { exists, isDirectory, listDirectories } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { FILE_PATTERNS } from '../constants/index.js';
import { DEFAULT_INSTALL_ROOT } from '../constants/workspace.js';
import { getLocalPackageYmlPath, getLocalPackagesDir } from '../utils/paths.js';
import { findFilesByExtension, findDirectoriesContainingFile } from '../utils/file-processing.js';
import { getDetectedPlatforms, getPlatformDefinition, type Platform } from './platforms.js';
import { arePackageNamesEquivalent } from '../utils/package-name.js';

/**
 * Package metadata from openpackage directory
 */
export interface OpenPackagePackage {
  name: string;
  version?: string;
  description?: string;
  dependencies?: PackageDependency[];
  'dev-dependencies'?: PackageDependency[];
  path: string;
}

/**
 * Find package config file in a directory.
 * Prefers v2 layout: <dir>/openpackage.yml, then <dir>/.openpackage/openpackage.yml (workspace-style).
 */
async function findPackageConfigFile(directoryPath: string): Promise<string | null> {
  const rootManifest = join(directoryPath, FILE_PATTERNS.OPENPACKAGE_YML);
  const workspaceManifest = getLocalPackageYmlPath(directoryPath);
  
  if (await exists(rootManifest)) {
    return rootManifest;
  } else if (await exists(workspaceManifest)) {
    return workspaceManifest;
  }
  
  return null;
}

/**
 * Get the version of an installed package by package name
 */
export async function getInstalledPackageVersion(packageName: string, targetDir: string): Promise<string | null> {
  const openpackagePath = join(targetDir, DEFAULT_INSTALL_ROOT);
  const packageOpenPackagePath = join(openpackagePath, packageName);
  
  if (!(await exists(packageOpenPackagePath))) {
    return null;
  }
  
  const configPath = await findPackageConfigFile(packageOpenPackagePath);
  if (!configPath) {
    return null;
  }
  
  try {
    const config = await parsePackageYml(configPath);
    return config.version ?? null;
  } catch (error) {
    logger.warn(`Failed to parse package config for ${packageName}: ${error}`);
    return null;
  }
}

/**
 * Find package directory in ai by matching package name
 */
export async function findPackageDirectory(openpackagePath: string, packageName: string): Promise<string | null> {
  if (!(await exists(openpackagePath)) || !(await isDirectory(openpackagePath))) {
    return null;
  }

  try {
    const subdirectories = await listDirectories(openpackagePath);
    
    for (const subdir of subdirectories) {
      const subdirPath = join(openpackagePath, subdir);
      const configPath = await findPackageConfigFile(subdirPath);
      
      if (configPath) {
        try {
          const packageConfig = await parsePackageYml(configPath);
          if (arePackageNamesEquivalent(packageConfig.name, packageName)) {
            return subdirPath;
          }
        } catch (error) {
          logger.warn(`Failed to parse package file ${configPath}: ${error}`);
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.error(`Failed to search ai directory: ${error}`);
    return null;
  }
}

/**
 * Scan openpackage directory for all available packages
 */
export async function scanOpenPackagePackages(openpackagePath: string): Promise<Map<string, OpenPackagePackage>> {
  const packages = new Map<string, OpenPackagePackage>();

  if (!(await exists(openpackagePath)) || !(await isDirectory(openpackagePath))) {
    logger.debug('Install root directory not found or not a directory', { openpackagePath });
    return packages;
  }

  try {
    // Find all openpackage.yml files recursively under the packages directory
    const packagesDir = getLocalPackagesDir(openpackagePath);
    if (!(await exists(packagesDir))) {
      return packages;
    }

    const packageDirs = await findDirectoriesContainingFile(
      packagesDir,
      FILE_PATTERNS.OPENPACKAGE_YML,
      async (filePath) => {
        try {
          return await parsePackageYml(filePath);
        } catch (error) {
          logger.warn(`Failed to parse package file ${filePath}: ${error}`);
          return null;
        }
      }
    );

    for (const { dirPath, parsedContent } of packageDirs) {
      if (parsedContent) {
        const packageConfig = parsedContent;
        packages.set(packageConfig.name, {
          name: packageConfig.name,
          version: packageConfig.version,
          description: packageConfig.description,
          dependencies: packageConfig.dependencies || [],
          'dev-dependencies': packageConfig['dev-dependencies'] || [],
          path: dirPath
        });
      }
    }
  } catch (error) {
    logger.error(`Failed to scan ai directory: ${error}`);
  }

  return packages;
}

/**
 * Gather version constraints from the main and cached package openpackage.yml files
 */
export async function gatherGlobalVersionConstraints(cwd: string, includeResolutions: boolean = true): Promise<Map<string, string[]>> {
  const constraints = new Map<string, Set<string>>();

  const addConstraint = (name?: string, range?: string) => {
    if (!name || !range) {
      return;
    }

    const trimmedName = name.trim();
    const trimmedRange = range.trim();

    if (!trimmedName || !trimmedRange) {
      return;
    }

    if (!constraints.has(trimmedName)) {
      constraints.set(trimmedName, new Set());
    }

    constraints.get(trimmedName)!.add(trimmedRange);
  };

  const collectFromConfig = (config: PackageYml | null | undefined) => {
    if (!config) {
      return;
    }

    config.dependencies?.forEach(dep => addConstraint(dep.name, dep.version));
    config['dev-dependencies']?.forEach(dep => addConstraint(dep.name, dep.version));
  };

  // Collect from main .openpackage/openpackage.yml if present
  const mainPackagePath = getLocalPackageYmlPath(cwd);
  if (await exists(mainPackagePath)) {
    try {
      const mainConfig = await parsePackageYml(mainPackagePath);
      collectFromConfig(mainConfig);
    } catch (error) {
      logger.debug(`Failed to parse main openpackage.yml for constraints: ${error}`);
    }
  }

  // Collect from each package under .openpackage/packages
  const packagesDir = getLocalPackagesDir(cwd);
  if (await exists(packagesDir) && await isDirectory(packagesDir)) {
    try {
      const packageDirs = await findDirectoriesContainingFile(
        packagesDir,
        FILE_PATTERNS.OPENPACKAGE_YML,
        async (filePath) => {
          try {
            return await parsePackageYml(filePath);
          } catch (error) {
            logger.debug(`Failed to parse openpackage.yml at ${filePath}: ${error}`);
            return null;
          }
        }
      );

      for (const { parsedContent } of packageDirs) {
        collectFromConfig(parsedContent);
      }
    } catch (error) {
      logger.debug(`Failed to enumerate packages directory for constraints: ${error}`);
    }
  }

  const result = new Map<string, string[]>();
  for (const [name, ranges] of constraints) {
    result.set(name, Array.from(ranges));
  }

  return result;
}

/**
 * Gather version constraints only from the main .openpackage/openpackage.yml
 * Used to treat root-declared versions as authoritative overrides
 */
export async function gatherRootVersionConstraints(cwd: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  const addConstraint = (name?: string, range?: string) => {
    if (!name || !range) return;
    const trimmedName = name.trim();
    const trimmedRange = range.trim();
    if (!trimmedName || !trimmedRange) return;
    if (!result.has(trimmedName)) result.set(trimmedName, []);
    const arr = result.get(trimmedName)!;
    if (!arr.includes(trimmedRange)) arr.push(trimmedRange);
  };

  const mainPackagePath = getLocalPackageYmlPath(cwd);
  if (await exists(mainPackagePath)) {
    try {
      const mainConfig = await parsePackageYml(mainPackagePath);
      mainConfig.dependencies?.forEach(dep => addConstraint(dep.name, dep.version));
      mainConfig['dev-dependencies']?.forEach(dep => addConstraint(dep.name, dep.version));
    } catch (error) {
      logger.debug(`Failed to parse main openpackage.yml for root constraints: ${error}`);
    }
  }

  return result;
}

/**
 * Get package configuration
 */
export async function getOpenPackagePackageConfig(openpackagePath: string, packageName: string): Promise<PackageYml | null> {
  const packagePath = await findPackageDirectory(openpackagePath, packageName);
  if (!packagePath) {
    return null;
  }
  
  const configPath = await findPackageConfigFile(packagePath);
  if (!configPath) {
    return null;
  }
  
  try {
    return await parsePackageYml(configPath);
  } catch (error) {
    logger.warn(`Failed to parse package config for ${packageName}: ${error}`);
    return null;
  }
}

/**
 * Check for existing installed package by searching markdown files in ai, .claude, and .cursor directories
 */
export async function checkExistingPackageInMarkdownFiles(
  cwd: string, 
  packageName: string
): Promise<{ found: boolean; version?: string; location?: string }> {
  // Build search targets: ai directory + all detected platform subdirectories
  const targets: Array<{ dir: string; exts?: string[]; label: string }> = [];

  // Always include workspace install root
  targets.push({
    dir: join(cwd, DEFAULT_INSTALL_ROOT),
    exts: [FILE_PATTERNS.MD_FILES],
    label: DEFAULT_INSTALL_ROOT
  });

  // Add detected platforms' directories from flows
  try {
    const platforms = await getDetectedPlatforms(cwd);
    for (const platform of platforms) {
      const def = getPlatformDefinition(platform as Platform);
      
      // Extract directories from export flows (package → workspace)
      if (def.export && def.export.length > 0) {
        const platformDirs = new Set<string>();
        
        for (const flow of def.export) {
          const toPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0];
          if (toPattern) {
            // Extract directory from pattern
            const parts = toPattern.split('/');
            if (parts.length > 1) {
              const fullPath = parts.slice(0, -1).join('/');
              platformDirs.add(fullPath);
            }
          }
        }
        
        // Add each unique directory as a target
        for (const dirPath of platformDirs) {
          const fullDirPath = join(cwd, dirPath);
          targets.push({ 
            dir: fullDirPath, 
            exts: undefined, // Allow all extensions (flows handle this)
            label: def.id 
          });
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to build platform search targets: ${error}`);
  }

  logger.debug(`Checking for existing package '${packageName}' across ${targets.length} locations`);

  // Search each target directory for files with supported extensions
  for (const target of targets) {
    const extensions = target.exts;
    if (extensions && extensions.length === 0) {
      continue;
    }

    try {
      const files = await findFilesByExtension(target.dir, extensions ?? []);
      for (const file of files) {
        // Frontmatter support removed - cannot determine package ownership
      }
    } catch (dirErr) {
      logger.debug(`Failed to search directory ${target.dir}: ${dirErr}`);
    }
  }

  return { found: false };
}
