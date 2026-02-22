import { basename, relative } from 'path';
import semver from 'semver';
import { PackageYml, PackageDependency } from '../types/index.js';
import { parsePackageYml, writePackageYml } from '../utils/package-yml.js';
import { exists, ensureDir } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath, getLocalPackagesDir, getLocalPackageDir, isRootPackage } from '../utils/paths.js';
import { DEPENDENCY_ARRAYS, FILE_PATTERNS, PACKAGE_PATHS } from '../constants/index.js';
import { createCaretRange, hasExplicitPrereleaseIntent, isPrereleaseVersion } from '../utils/version-ranges.js';
import { extractBaseVersion } from '../utils/version-generator.js';
import { isUnversionedVersion } from '../utils/package-versioning.js';
import { normalizePackageName, arePackageNamesEquivalent, normalizePackageNameForLookup } from '../utils/package-name.js';
import { extractGitHubInfo } from '../utils/git-url-parser.js';
import { packageManager } from './package.js';
import type { OutputPort } from './ports/output.js';
import type { PromptPort } from './ports/prompt.js';
import { resolveOutput, resolvePrompt } from './ports/resolve.js';
import { writePackageFilesToDirectory } from '../utils/package-copy.js';
import { getPackageFilesDir, getPackageYmlPath } from './package-context.js';
import { isManifestPath, normalizePackagePath } from '../utils/manifest-paths.js';

/**
 * Ensure local OpenPackage directory structure exists
 * Shared utility for both install and save commands
 */
export async function ensureLocalOpenPackageStructure(targetDir: string): Promise<void> {
  const openpackageDir = getLocalOpenPackageDir(targetDir);
  const packagesDir = getLocalPackagesDir(targetDir);
  
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
export async function createWorkspacePackageYml(targetDir: string, force: boolean = false, output?: OutputPort): Promise<PackageYml | null> {
  const out = output ?? resolveOutput();
  await ensureLocalOpenPackageStructure(targetDir);

  const packageYmlPath = getLocalPackageYmlPath(targetDir);
  const projectName = basename(targetDir);
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
    out.success(`Overwrote basic openpackage.yml in .openpackage/ with name: ${projectName}`);
    return basicPackageYml;
  }

  await writePackageYml(packageYmlPath, basicPackageYml);
  logger.info(`Initialized workspace openpackage.yml`);
  out.success(`Initialized workspace openpackage.yml in .openpackage/`);
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
  targetDir: string,
  packageName: string,
  options: EnsurePackageWithYmlOptions = {},
  output?: OutputPort,
  prompt?: PromptPort
): Promise<EnsurePackageWithYmlResult> {
  const out = output ?? resolveOutput();
  const prm = prompt ?? resolvePrompt();
  await ensureLocalOpenPackageStructure(targetDir);

  const normalizedName = normalizePackageName(packageName);
  const packageDir = getPackageFilesDir(targetDir, 'nested', normalizedName);
  const packageYmlPath = getPackageYmlPath(targetDir, 'nested', normalizedName);

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
        out.success(`Loaded openpackage.yml from local registry for ${normalizedName}`);
      }
    } catch (error) {
      logger.debug('Unable to seed openpackage.yml from registry; falling back to prompts', { normalizedName, error });
    }

    if (!packageConfig) {
      if (options.interactive) {
        out.info(`Create new package "${normalizedName}"`);
        
        const description = await prm.text('Description:');
        const keywordsInput = await prm.text('Keywords (space-separated):');
        const isPrivate = await prm.confirm('Private package?', false);
        
        const keywordsArray = keywordsInput
          ? keywordsInput.trim().split(/\s+/).filter((k: string) => k.length > 0)
          : [];
        
        packageConfig = {
          name: normalizePackageName(normalizedName),
          ...(description && { description }),
          ...(keywordsArray.length > 0 && { keywords: keywordsArray }),
          ...(isPrivate && { private: isPrivate })
        };
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
      `Created new package '${packageConfig.name}${packageConfig.version ? `@${packageConfig.version}` : ''}' at ${relative(targetDir, packageDir)}`
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
  targetDir: string,
  packageName: string,
  packageVersion: string | undefined,
  isDev: boolean = false,
  originalVersion?: string, // The original version/range that was requested
  silent: boolean = false,
  path?: string,  // Path to local directory or tarball (for path-based dependencies)
  git?: string,   // Git source url (DEPRECATED: use url) (mutually exclusive with path/version)
  ref?: string,   // Git ref (DEPRECATED: embed in url as #ref)
  gitPath?: string,  // Git subdirectory path (for plugins in marketplaces)
  base?: string,  // Phase 4: Base field for resource model
  output?: OutputPort
): Promise<void> {
  const out = output ?? resolveOutput();
  const packageYmlPath = getLocalPackageYmlPath(targetDir);
  
  if (!(await exists(packageYmlPath))) {
    return; // If no openpackage.yml exists, ignore this step
  }
  
  // Don't add the workspace package to its own manifest
  if (await isRootPackage(targetDir, packageName)) {
    logger.debug(`Skipping manifest update: package '${packageName}' is the workspace package itself`);
    return;
  }
  
  const config = await parsePackageYml(packageYmlPath);
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

  // Build url field with embedded ref for git sources
  let urlField: string | undefined;
  if (git) {
    urlField = ref ? `${git}#${ref}` : git;
  }
  
  const dependency: PackageDependency = {
    name: normalizedPackageName,
    ...(versionToWrite ? { version: versionToWrite } : {}),
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
    if (versionChanged) {
      targetArrayRef[existingTargetIndex] = dependency;
      if (!silent) {
        logger.info(`Updated existing package dependency: ${nameWithVersion}`);
        out.success(`Updated ${nameWithVersion} in main openpackage.yml`);
      }
    }
  } else {
    targetArrayRef.push(dependency);
    if (!silent) {
      logger.info(`Added new package dependency: ${nameWithVersion}`);
      out.success(`Added ${nameWithVersion} to main openpackage.yml`);
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
  const gitUrlRaw = dep.url || dep.git;
  if (gitUrlRaw) {
    const githubInfo = extractGitHubInfo(gitUrlRaw);
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
 * Remove a dependency entry from a manifest file (both dependencies and dev-dependencies).
 * Use this when removing from a specific package manifest (e.g. --from essentials).
 *
 * @param manifestPath - Absolute path to openpackage.yml
 * @param dependencyName - User-specified name to match (e.g. essential-agent, @scope/pkg)
 * @returns true if a dependency was removed, false otherwise
 */
export async function removeDependencyFromManifest(
  manifestPath: string,
  dependencyName: string
): Promise<boolean> {
  if (!(await exists(manifestPath))) return false;

  try {
    const config = await parsePackageYml(manifestPath);
    const sections: Array<'dependencies' | 'dev-dependencies'> = [DEPENDENCY_ARRAYS.DEPENDENCIES, DEPENDENCY_ARRAYS.DEV_DEPENDENCIES];
    let removed = false;
    let hadAnyDependencies = false;

    for (const section of sections) {
      const arr = config[section];
      if (!arr) continue;
      if (arr.length > 0) hadAnyDependencies = true;

      // Filter out dependencies that match the package name
      // Uses context-aware matching to handle git sources and naming migrations
      const next = arr.filter(dep => !doesDependencyMatchPackageName(dep, dependencyName));

      if (next.length !== arr.length) {
        config[section] = next as any;
        removed = true;
      }
    }

    // Always write the config if:
    // 1. A package was removed (to persist the removal), OR
    // 2. The file had dependencies (to trigger migration even if no removal happened)
    if (removed || hadAnyDependencies) {
      await writePackageYml(manifestPath, config);
    }
    return removed;
  } catch (error) {
    logger.warn(`Failed to update openpackage.yml when removing ${dependencyName}: ${error}`);
    return false;
  }
}

/**
 * Remove a dependency entry from openpackage.yml (both dependencies and dev-dependencies).
 * Operates on the workspace manifest at .openpackage/openpackage.yml
 */
export async function removePackageFromOpenpackageYml(
  targetDir: string,
  packageName: string
): Promise<boolean> {
  const packageYmlPath = getLocalPackageYmlPath(targetDir);
  return removeDependencyFromManifest(packageYmlPath, packageName);
}

/**
 * Check if a manifest contains a dependency matching the user input.
 * Uses context-aware matching (direct name, git variations, etc.).
 *
 * @param manifestPath - Absolute path to openpackage.yml
 * @param userInput - User-specified name (e.g. essential-agent, .opencode)
 * @returns The matched dependency's stored name if found, null otherwise
 */
export async function findMatchingDependencyInManifest(
  manifestPath: string,
  userInput: string
): Promise<string | null> {
  if (!(await exists(manifestPath))) return null;

  try {
    const config = await parsePackageYml(manifestPath);
    const sections: Array<'dependencies' | 'dev-dependencies'> = [DEPENDENCY_ARRAYS.DEPENDENCIES, DEPENDENCY_ARRAYS.DEV_DEPENDENCIES];

    for (const section of sections) {
      const arr = config[section];
      if (!arr) continue;

      const match = arr.find(dep => doesDependencyMatchPackageName(dep, userInput));
      if (match) return match.name;
    }
    return null;
  } catch {
    return null;
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


