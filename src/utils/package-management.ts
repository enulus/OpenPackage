import { basename, relative } from 'path';
import semver from 'semver';
import { PackageYml, PackageDependency } from '../types/index.js';
import { parsePackageYml, writePackageYml } from './package-yml.js';
import { exists, ensureDir } from './fs.js';
import { logger } from './logger.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath, getLocalPackagesDir, getLocalPackageDir } from './paths.js';
import { DEPENDENCY_ARRAYS, FILE_PATTERNS, PACKAGE_PATHS } from '../constants/index.js';
import { createCaretRange, hasExplicitPrereleaseIntent, isPrereleaseVersion } from './version-ranges.js';
import { extractBaseVersion } from './version-generator.js';
import { isUnversionedVersion } from './package-versioning.js';
import { normalizePackageName, arePackageNamesEquivalent } from './package-name.js';
import { packageManager } from '../core/package.js';
import { promptPackageDetailsForNamed } from './prompts.js';
import { writePackageFilesToDirectory } from './package-copy.js';
import { getPackageFilesDir, getPackageYmlPath } from '../core/package-context.js';
import { buildNormalizedIncludeSet, isManifestPath, normalizePackagePath } from './manifest-paths.js';

/**
 * Ensure local OpenPackage directory structure exists
 * Shared utility for both install and save commands
 */
export async function ensureLocalOpenPackageStructure(cwd: string): Promise<void> {
  const openpackageDir = getLocalOpenPackageDir(cwd);
  const packagesDir = getLocalPackagesDir(cwd);
  
  await Promise.all([
    ensureDir(openpackageDir),
    ensureDir(packagesDir)
  ]);
}

/**
 * Create a basic openpackage.yml file for workspace if it doesn't exist
 * Shared utility for both install and save commands
 * @param force - If true, overwrite existing openpackage.yml
 * @returns the openpackage.yml if it was created, null if it already existed and force=false
 */
export async function createWorkspacePackageYml(cwd: string, force: boolean = false): Promise<PackageYml | null> {
  await ensureLocalOpenPackageStructure(cwd);

  const packageYmlPath = getLocalPackageYmlPath(cwd);
  const projectName = basename(cwd);
  const basicPackageYml: PackageYml = {
    name: projectName,
    packages: [],
    'dev-packages': []
  };

  if (await exists(packageYmlPath)) {
    if (!force) {
      return null; // openpackage.yml already exists, no need to create
    }
    await writePackageYml(packageYmlPath, basicPackageYml);
    logger.info(`Overwrote basic openpackage.yml with name: ${projectName}`);
    console.log(`📋 Overwrote basic openpackage.yml in .openpackage/ with name: ${projectName}`);
    return basicPackageYml;
  }

  await writePackageYml(packageYmlPath, basicPackageYml);
  logger.info(`Initialized workspace openpackage.yml`);
  console.log(`📋 Initialized workspace openpackage.yml in .openpackage/`);
  return basicPackageYml;
}

export interface EnsurePackageWithYmlOptions {
  interactive?: boolean;
  defaultVersion?: string;
}

export interface EnsurePackageWithYmlResult {
  normalizedName: string;
  packageDir: string;
  packageYmlPath: string;
  packageConfig: PackageYml;
  isNew: boolean;
}

/**
 * Ensure a cached package directory and openpackage.yml exist, optionally prompting for details.
 * This is for NESTED packages only. Root packages use different flow.
 */
export async function ensurePackageWithYml(
  cwd: string,
  packageName: string,
  options: EnsurePackageWithYmlOptions = {}
): Promise<EnsurePackageWithYmlResult> {
  await ensureLocalOpenPackageStructure(cwd);

  const normalizedName = normalizePackageName(packageName);
  const packageDir = getPackageFilesDir(cwd, 'nested', normalizedName);
  const packageYmlPath = getPackageYmlPath(cwd, 'nested', normalizedName);

  await ensureDir(packageDir);

  let packageConfig: PackageYml | undefined;
  let isNew = false;

  if (await exists(packageYmlPath)) {
    packageConfig = await parsePackageYml(packageYmlPath);
  } else {
    isNew = true;
    // Try to seed from existing local registry copy to avoid prompts and preserve metadata.
    try {
      const registryExists = await packageManager.packageExists(normalizedName);
      if (registryExists) {
        const existing = await packageManager.loadPackage(normalizedName);
        packageConfig = {
          ...existing.metadata,
          name: normalizedName,
          partial: true
        };
        logger.info(`Loaded openpackage.yml for '${normalizedName}' from local registry copy`);
        console.log(`✓ Loaded openpackage.yml from local registry for ${normalizedName}`);
      }
    } catch (error) {
      logger.debug('Unable to seed openpackage.yml from registry; falling back to prompts', { normalizedName, error });
    }

    if (!packageConfig) {
      if (options.interactive) {
        console.log(`Create new package "${normalizedName}"`);
        packageConfig = await promptPackageDetailsForNamed(normalizedName);
      } else {
        packageConfig = {
          name: normalizedName,
          ...(options.defaultVersion ? { version: options.defaultVersion } : {})
        };
      }

      packageConfig = {
        ...packageConfig,
        partial: true
      };
    }

    await writePackageYml(packageYmlPath, packageConfig);
    logger.info(
      `Created new package '${packageConfig.name}${packageConfig.version ? `@${packageConfig.version}` : ''}' at ${relative(cwd, packageDir)}`
    );
  }

  if (packageConfig.name !== normalizedName) {
    const updatedConfig = { ...packageConfig, name: normalizedName };
    await writePackageYml(packageYmlPath, updatedConfig);
    packageConfig = updatedConfig;
  }

  return {
    normalizedName,
    packageDir,
    packageYmlPath,
    packageConfig,
    isNew
  };
}

/**
 * Add a package dependency to openpackage.yml with smart placement logic
 * Shared utility for both install and save commands
 */
export async function addPackageToYml(
  cwd: string,
  packageName: string,
  packageVersion: string | undefined,
  isDev: boolean = false,
  originalVersion?: string, // The original version/range that was requested
  silent: boolean = false,
  include?: string[] | null,
  path?: string,  // Path to local directory or tarball (for path-based dependencies)
  git?: string,   // Git source url (mutually exclusive with path/version)
  ref?: string,   // Git ref (branch/tag/sha)
  subdirectory?: string  // Git subdirectory path (for plugins in marketplaces)
): Promise<void> {
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  
  if (!(await exists(packageYmlPath))) {
    return; // If no openpackage.yml exists, ignore this step
  }
  
  const config = await parsePackageYml(packageYmlPath);
  if (!config.packages) config.packages = [];
  if (!config[DEPENDENCY_ARRAYS.DEV_PACKAGES]) config[DEPENDENCY_ARRAYS.DEV_PACKAGES] = [];

  const normalizedPackageName = normalizePackageName(packageName);
  const nameWithVersion = packageVersion ? `${packageName}@${packageVersion}` : packageName;
  const packagesArray = config.packages;
  const devPackagesArray = config[DEPENDENCY_ARRAYS.DEV_PACKAGES]!;

  const findIndex = (arr: PackageDependency[]): number =>
    arr.findIndex(dep => arePackageNamesEquivalent(dep.name, normalizedPackageName));

  let currentLocation: 'packages' | 'dev-packages' | null = null;
  let existingIndex = findIndex(packagesArray);
  if (existingIndex >= 0) {
    currentLocation = DEPENDENCY_ARRAYS.PACKAGES;
  } else {
    existingIndex = findIndex(devPackagesArray);
    if (existingIndex >= 0) {
      currentLocation = DEPENDENCY_ARRAYS.DEV_PACKAGES;
    } else {
      existingIndex = -1;
    }
  }

  const existingRange =
    currentLocation && existingIndex >= 0
      ? config[currentLocation]![existingIndex]?.version
      : undefined;

  const shouldOmitVersion = isUnversionedVersion(packageVersion) || isUnversionedVersion(originalVersion);
  let versionToWrite: string | undefined = git ? undefined : shouldOmitVersion ? undefined : originalVersion;

  if (!git && !shouldOmitVersion && packageVersion) {
    const baseVersion = extractBaseVersion(packageVersion);
    const defaultRange = createCaretRange(baseVersion);
    versionToWrite = originalVersion ?? defaultRange;

    if (!originalVersion && existingRange) {
      const hasPrereleaseIntent = hasExplicitPrereleaseIntent(existingRange);
      const isNewVersionStable = !isPrereleaseVersion(packageVersion);

      if (hasPrereleaseIntent) {
        if (isNewVersionStable) {
          // Constraint has explicit prerelease intent and we're packing a stable
          // version on the same base line: normalize to a stable caret.
          versionToWrite = createCaretRange(baseVersion);
          logger.debug(
            `Updating range from prerelease-including '${existingRange}' to stable '${versionToWrite}' ` +
            `for ${packageName} (pack transition to ${packageVersion})`
          );
        } else {
          // For prerelease-intent ranges during saves (prerelease versions),
          // always preserve the existing constraint.
          versionToWrite = existingRange;
        }
      } else if (rangeIncludesVersion(existingRange, baseVersion)) {
        // Stable (non-prerelease) constraint that already includes the new base
        // version: keep it unchanged.
        versionToWrite = existingRange;
      } else {
        // Stable constraint that does not include the new base version: bump to
        // a new caret on the packed stable.
        versionToWrite = defaultRange;
      }
    }
  }

  const existingDep =
    currentLocation && existingIndex >= 0 ? config[currentLocation]![existingIndex] : null;

  let includeToWrite: string[] | undefined;
  if (include === undefined) {
    includeToWrite = existingDep?.include;
  } else if (include === null) {
    includeToWrite = undefined;
  } else {
    const unique = Array.from(new Set(include));
    includeToWrite = unique.length > 0 ? unique : undefined;
  }

  const dependency: PackageDependency = {
    name: normalizedPackageName,
    ...(versionToWrite ? { version: versionToWrite } : {}),
    ...(includeToWrite ? { include: includeToWrite } : {}),
    ...(path ? { path } : {}),
    ...(git ? { git } : {}),
    ...(ref ? { ref } : {}),
    ...(subdirectory ? { subdirectory } : {})
  };
  
  // Determine target location (packages vs dev-packages)
  
  let targetArray: 'packages' | 'dev-packages';
  if (currentLocation === DEPENDENCY_ARRAYS.DEV_PACKAGES && !isDev) {
    targetArray = DEPENDENCY_ARRAYS.DEV_PACKAGES;
    logger.info(`Keeping package in dev-packages: ${nameWithVersion}`);
  } else if (currentLocation === DEPENDENCY_ARRAYS.PACKAGES && isDev) {
    targetArray = DEPENDENCY_ARRAYS.DEV_PACKAGES;
    logger.info(`Moving package from packages to dev-packages: ${nameWithVersion}`);
  } else {
    targetArray = isDev ? DEPENDENCY_ARRAYS.DEV_PACKAGES : DEPENDENCY_ARRAYS.PACKAGES;
  }
  
  // Remove from current location if moving between arrays
  if (currentLocation && currentLocation !== targetArray && existingIndex >= 0) {
    config[currentLocation]!.splice(existingIndex, 1);
    existingIndex = -1;
    currentLocation = null;
  }
  
  // Update or add dependency
  const targetArrayRef = config[targetArray]!;
  const existingTargetIndex =
    currentLocation === targetArray ? findIndex(targetArrayRef) : -1;
  
  if (existingTargetIndex >= 0) {
    const existingDepForTarget = targetArrayRef[existingTargetIndex];
    const versionChanged = existingDepForTarget.version !== dependency.version;
    const includeChanged =
      JSON.stringify(existingDepForTarget.include ?? []) !== JSON.stringify(includeToWrite ?? []);
    if (versionChanged || includeChanged) {
      targetArrayRef[existingTargetIndex] = dependency;
      if (!silent) {
        logger.info(`Updated existing package dependency: ${nameWithVersion}`);
        console.log(`✓ Updated ${nameWithVersion} in main openpackage.yml`);
      }
    }
  } else {
    targetArrayRef.push(dependency);
    if (!silent) {
      logger.info(`Added new package dependency: ${nameWithVersion}`);
      console.log(`✓ Added ${nameWithVersion} to main openpackage.yml`);
    }
  }
  
  await writePackageYml(packageYmlPath, config);
}

/**
 * Copy the full package directory from the local registry into the project structure
 * Removes all existing files except the package index file before writing new files
 */
export async function writeLocalPackageFromRegistry(
  cwd: string,
  packageName: string,
  version: string
): Promise<void> {
  const pkg = await packageManager.loadPackage(packageName, version);
  const localPackageDir = getLocalPackageDir(cwd, packageName);

  await writePackageFilesToDirectory(localPackageDir, pkg.files, {
    preserveIndexFile: true
  });
}

/**
 * Copy a subset of package files from the local registry into the project cache (.openpackage/packages/<pkg>/),
 * always including openpackage.yml. Used for partial installs.
 */
export async function writePartialLocalPackageFromRegistry(
  cwd: string,
  packageName: string,
  version: string,
  includePaths: string[]
): Promise<void> {
  const pkg = await packageManager.loadPackage(packageName, version);
  const localPackageDir = getLocalPackageDir(cwd, packageName);

  const normalizedIncludes = buildNormalizedIncludeSet(includePaths);

  const filteredFiles = pkg.files.filter(file => {
    const p = normalizePackagePath(file.path);
    if (isManifestPath(p)) return true; // always keep manifest
    if (p === PACKAGE_PATHS.INDEX_RELATIVE) return false; // never copy index from registry
    if (!normalizedIncludes) return true;
    return normalizedIncludes.has(p);
  });

  await writePackageFilesToDirectory(localPackageDir, filteredFiles, {
    preserveIndexFile: true
  });
}

/**
 * Update only the include list for an existing dependency in openpackage.yml.
 * - include: string[] => set/dedupe
 * - include: null     => clear include field
 * - include: undefined => no-op
 */
export async function updatePackageDependencyInclude(
  cwd: string,
  packageName: string,
  target: 'packages' | 'dev-packages',
  include: string[] | null | undefined
): Promise<void> {
  if (include === undefined) return;

  const packageYmlPath = getLocalPackageYmlPath(cwd);
  if (!(await exists(packageYmlPath))) return;

  const config = await parsePackageYml(packageYmlPath);
  const arr = config[target];
  if (!arr) return;

  const idx = arr.findIndex(dep => arePackageNamesEquivalent(dep.name, packageName));
  if (idx === -1) return;

  const unique = include === null ? undefined : Array.from(new Set(include));
  if (unique && unique.length > 0) {
    arr[idx].include = unique;
  } else {
    delete arr[idx].include;
  }

  await writePackageYml(packageYmlPath, config);
}

/**
 * Remove a dependency entry from openpackage.yml (both packages and dev-packages).
 */
export async function removePackageFromOpenpackageYml(
  cwd: string,
  packageName: string
): Promise<boolean> {
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  if (!(await exists(packageYmlPath))) return false;

  try {
    const config = await parsePackageYml(packageYmlPath);
    const sections: Array<'packages' | 'dev-packages'> = [DEPENDENCY_ARRAYS.PACKAGES, DEPENDENCY_ARRAYS.DEV_PACKAGES];
    let removed = false;

    for (const section of sections) {
      const arr = config[section];
      if (!arr) continue;
      const next = arr.filter(dep => !arePackageNamesEquivalent(dep.name, packageName));
      if (next.length !== arr.length) {
        config[section] = next as any;
        removed = true;
      }
    }

    if (removed) {
      await writePackageYml(packageYmlPath, config);
    }
    return removed;
  } catch (error) {
    logger.warn(`Failed to update openpackage.yml when removing ${packageName}: ${error}`);
    return false;
  }
}

function rangeIncludesVersion(range: string, version: string): boolean {
  if (!range || !version) {
    return false;
  }
  try {
    return semver.satisfies(version, range, { includePrerelease: true });
  } catch {
    return false;
  }
}

/**
 * Check if a package is a path-based dependency in the workspace openpackage.yml.
 * Path-based dependencies should be skipped during save operations.
 */
export async function isPathBasedDependency(cwd: string, packageName: string): Promise<boolean> {
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  if (!(await exists(packageYmlPath))) {
    return false;
  }

  try {
    const config = await parsePackageYml(packageYmlPath);
    const allDeps = [...(config.packages || []), ...(config['dev-packages'] || [])];
    const dep = allDeps.find(d => arePackageNamesEquivalent(d.name, packageName));
    return Boolean(dep?.path);
  } catch {
    return false;
  }
}
