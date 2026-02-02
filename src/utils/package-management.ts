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
import { normalizePackageName, arePackageNamesEquivalent, normalizePackageNameForLookup } from './package-name.js';
import { extractGitHubInfo } from './git-url-parser.js';
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
    dependencies: [],
    'dev-dependencies': []
  };

  if (await exists(packageYmlPath)) {
    if (!force) {
      return null; // openpackage.yml already exists, no need to create
    }
    await writePackageYml(packageYmlPath, basicPackageYml);
    logger.info(`Overwrote basic openpackage.yml with name: ${projectName}`);
    console.log(`✓ Overwrote basic openpackage.yml in .openpackage/ with name: ${projectName}`);
    return basicPackageYml;
  }

  await writePackageYml(packageYmlPath, basicPackageYml);
  logger.info(`Initialized workspace openpackage.yml`);
  console.log(`✓ Initialized workspace openpackage.yml in .openpackage/`);
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
  git?: string,   // Git source url (DEPRECATED: use url) (mutually exclusive with path/version)
  ref?: string,   // Git ref (DEPRECATED: embed in url as #ref)
  gitPath?: string,  // Git subdirectory path (for plugins in marketplaces)
  base?: string  // Phase 4: Base path for resource-based installation
): Promise<void> {
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  
  if (!(await exists(packageYmlPath))) {
    return; // If no openpackage.yml exists, ignore this step
  }
  
  const config = await parsePackageYml(packageYmlPath);
  
  // Don't add the workspace package to its own manifest
  // Check if the package name matches the workspace manifest name
  const workspacePackageName = config.name;
  if (workspacePackageName && arePackageNamesEquivalent(packageName, workspacePackageName)) {
    logger.debug(`Skipping manifest update: package '${packageName}' is the workspace package itself`);
    return;
  }
  if (!config.dependencies) config.dependencies = [];
  if (!config[DEPENDENCY_ARRAYS.DEV_DEPENDENCIES]) config[DEPENDENCY_ARRAYS.DEV_DEPENDENCIES] = [];

  const normalizedPackageName = normalizePackageName(packageName);
  const nameWithVersion = packageVersion ? `${packageName}@${packageVersion}` : packageName;
  const dependenciesArray = config.dependencies;
  const devDependenciesArray = config[DEPENDENCY_ARRAYS.DEV_DEPENDENCIES]!;

  const findIndex = (arr: PackageDependency[]): number =>
    arr.findIndex(dep => arePackageNamesEquivalent(dep.name, normalizedPackageName));

  let currentLocation: 'dependencies' | 'dev-dependencies' | null = null;
  let existingIndex = findIndex(dependenciesArray);
  if (existingIndex >= 0) {
    currentLocation = DEPENDENCY_ARRAYS.DEPENDENCIES;
  } else {
    existingIndex = findIndex(devDependenciesArray);
    if (existingIndex >= 0) {
      currentLocation = DEPENDENCY_ARRAYS.DEV_DEPENDENCIES;
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

  // Build url field with embedded ref for git sources
  let urlField: string | undefined;
  if (git) {
    urlField = ref ? `${git}#${ref}` : git;
  }
  
  const dependency: PackageDependency = {
    name: normalizedPackageName,
    ...(versionToWrite ? { version: versionToWrite } : {}),
    ...(includeToWrite ? { include: includeToWrite } : {}),
    ...(path && !git ? { path } : {}),  // Only use path for local sources
    ...(urlField ? { url: urlField } : {}),  // Use url with embedded ref
    ...(gitPath ? { path: gitPath } : {}),  // Use path field for git subdirectory
    ...(base ? { base } : {})  // Phase 4: Base field for resource model
  };
  
  // Determine target location (dependencies vs dev-dependencies)
  
  let targetArray: 'dependencies' | 'dev-dependencies';
  if (currentLocation === DEPENDENCY_ARRAYS.DEV_DEPENDENCIES && !isDev) {
    targetArray = DEPENDENCY_ARRAYS.DEV_DEPENDENCIES;
    logger.info(`Keeping package in dev-dependencies: ${nameWithVersion}`);
  } else if (currentLocation === DEPENDENCY_ARRAYS.DEPENDENCIES && isDev) {
    targetArray = DEPENDENCY_ARRAYS.DEV_DEPENDENCIES;
    logger.info(`Moving package from dependencies to dev-dependencies: ${nameWithVersion}`);
  } else {
    targetArray = isDev ? DEPENDENCY_ARRAYS.DEV_DEPENDENCIES : DEPENDENCY_ARRAYS.DEPENDENCIES;
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
 * Check if a dependency matches a given package name, handling various naming formats.
 * This function supports matching across format migrations:
 * - Direct name comparison (after normalization)
 * - Git-based matching (username/repo/path combinations)
 * 
 * Examples of matches:
 * - "anthropics/claude-plugins-official/code-review" matches "ghanthropics/claude-plugins-official/plugins/code-review"
 * - "@anthropics/claude-plugins-official" matches "ghanthropics/claude-plugins-official"
 * - "username/repo" matches "gh@username/repo"
 */
function doesDependencyMatchPackageName(
  dep: PackageDependency,
  userInputName: string
): boolean {
  // Normalize both for direct comparison
  const normalizedDepName = normalizePackageNameForLookup(dep.name);
  const normalizedUserName = normalizePackageNameForLookup(userInputName);
  
  // Direct match after normalization
  if (normalizedDepName === normalizedUserName) {
    return true;
  }
  
  // If dependency has a git source, try matching based on git URL + path
  if (dep.git) {
    const githubInfo = extractGitHubInfo(dep.git);
    if (!githubInfo) {
      return false;
    }
    
    const { username, repo } = githubInfo;
    
    // Get the actual path from dependency (prefer path over subdirectory)
    const actualPath = dep.path || (dep.subdirectory?.startsWith('./') 
      ? dep.subdirectory.substring(2) 
      : dep.subdirectory);
    
    // Build all possible name variations that could match
    const possibleNames = [
      `${username}/${repo}`,
      `@${username}/${repo}`,
      `gh@${username}/${repo}`,
    ];
    
    if (actualPath) {
      possibleNames.push(
        `${username}/${repo}/${actualPath}`,
        `@${username}/${repo}/${actualPath}`,
        `gh@${username}/${repo}/${actualPath}`,
      );
      
      // Also try with just the basename of the path
      // e.g., "plugins/code-review" -> "code-review"
      const pathBasename = actualPath.split('/').pop();
      if (pathBasename && pathBasename !== actualPath) {
        possibleNames.push(
          `${username}/${repo}/${pathBasename}`,
          `@${username}/${repo}/${pathBasename}`,
          `gh@${username}/${repo}/${pathBasename}`,
        );
      }
    }
    
    // Check if any possible name matches the user input (case-insensitive)
    const normalizedInput = normalizePackageName(userInputName);
    for (const possibleName of possibleNames) {
      if (normalizePackageName(possibleName) === normalizedInput) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Remove a dependency entry from openpackage.yml (both dependencies and dev-dependencies).
 */
export async function removePackageFromOpenpackageYml(
  cwd: string,
  packageName: string
): Promise<boolean> {
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  if (!(await exists(packageYmlPath))) return false;

  try {
    const config = await parsePackageYml(packageYmlPath);
    const sections: Array<'dependencies' | 'dev-dependencies'> = [DEPENDENCY_ARRAYS.DEPENDENCIES, DEPENDENCY_ARRAYS.DEV_DEPENDENCIES];
    let removed = false;
    let hadAnyDependencies = false;

    for (const section of sections) {
      const arr = config[section];
      if (!arr) continue;
      if (arr.length > 0) hadAnyDependencies = true;
      
      // Filter out dependencies that match the package name
      // Uses context-aware matching to handle git sources and naming migrations
      const next = arr.filter(dep => !doesDependencyMatchPackageName(dep, packageName));
      
      if (next.length !== arr.length) {
        config[section] = next as any;
        removed = true;
      }
    }

    // Always write the config if:
    // 1. A package was removed (to persist the removal), OR
    // 2. The file had dependencies (to trigger migration even if no removal happened)
    if (removed || hadAnyDependencies) {
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


