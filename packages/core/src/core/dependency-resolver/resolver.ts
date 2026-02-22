/**
 * Legacy Recursive Dependency Resolver
 * 
 * @deprecated This module is deprecated for new code. Use DependencyResolutionExecutor
 * from '../install/resolution/executor.js' for recursive dependency resolution.
 * 
 * This function is still used by the unified pipeline for single-package installs
 * and will be migrated in a future release.
 */

import * as yaml from 'js-yaml';
import * as semver from 'semver';
import { resolve, dirname } from 'path';
import { PackageYml, Package } from '../../types/index.js';
import { packageManager } from '../package.js';
import { getInstalledPackageVersion } from '../openpackage.js';
import { logger } from '../../utils/logger.js';
import { PackageNotFoundError, VersionConflictError } from '../../utils/errors.js';
import { hasExplicitPrereleaseIntent } from '../../utils/version-ranges.js';
import { listPackageVersions, getLatestPackageVersion, findPackageByName, hasPackageVersion } from '../directory.js';
import { selectInstallVersionUnified } from '../install/version-selection.js';
import { InstallResolutionMode, type PackageRemoteResolutionOutcome } from '../install/types.js';
import { extractRemoteErrorReason } from '../../utils/error-reasons.js';
import { PACKAGE_PATHS } from '../../constants/index.js';
import { loadPackageFromPath } from '../install/path-package-loader.js';
import { loadPackageFromGit } from '../install/git-package-loader.js';
import {
  resolveCandidateVersionsForInstall,
  type CandidateVersionsResult,
  maybeWarnHigherRegistryVersion,
  resolvePackageContentRoot
} from '../install/local-source-resolution.js';
import type { ResolvedPackage } from './types.js';
import { promptOverwrite } from './prompts.js';

interface DependencyResolverOptions {
  mode?: InstallResolutionMode;
  profile?: string;
  apiKey?: string;
  onWarning?: (message: string) => void;
  skipCache?: boolean;  // Force fresh git clones (for --remote flag)
}

export interface ResolveDependenciesResult {
  resolvedPackages: ResolvedPackage[];
  missingPackages: string[];
  remoteOutcomes?: Record<string, PackageRemoteResolutionOutcome>;
}

/**
 * Recursively resolve package dependencies for installation
 * 
 * @deprecated This function is part of the legacy dependency resolver.
 * Consider using the modular dependency resolution utilities from
 * `./dependency-resolver/` for new code. This function will be refactored
 * in a future release.
 */
export async function resolveDependencies(
  packageName: string,
  targetDir: string,
  isRoot: boolean = true,
  visitedStack: Set<string> = new Set(),
  resolvedPackages: Map<string, ResolvedPackage> = new Map(),
  version?: string,
  requiredVersions: Map<string, string[]> = new Map(),
  globalConstraints?: Map<string, string[]>,
  rootOverrides?: Map<string, string[]>,
  resolverOptions: DependencyResolverOptions = {},
  remoteOutcomes: Map<string, PackageRemoteResolutionOutcome> = new Map(),
  currentPackageSourcePath?: string  // Path to the package that declared this dependency (for resolving relative paths)
): Promise<ResolveDependenciesResult> {
  // Track missing dependencies for this invocation subtree
  const missing = new Set<string>();
  const resolutionMode: InstallResolutionMode = resolverOptions.mode ?? 'local-only';

  // 1. Cycle detection
  if (visitedStack.has(packageName)) {
    const cycle = Array.from(visitedStack);
    const cycleStart = cycle.indexOf(packageName);
    const actualCycle = cycle.slice(cycleStart).concat([packageName]);
    const warning =
      `Circular dependency detected:\n` +
      `   ${actualCycle.join(' → ')}\n` +
      `💡 Review your package dependencies to break the cycle.\n` +
      `   (The cycle will be skipped for this install run.)`;
    // Surface as a warning via logger and resolver callback, but do NOT mark the
    // package as missing. This keeps the install flow running without falsely
    // reporting the root package as a missing dependency.
    logger.warn(warning);
    if (resolverOptions.onWarning) {
      resolverOptions.onWarning(warning);
    }
    return buildResolveResult(resolvedPackages, missing, remoteOutcomes);
  }
  
  // 1.5. Check if already resolved (e.g., from path/git source)
  // This avoids expensive version resolution, remote lookups, and package loading
  // for packages that have already been resolved (e.g., path-based installs)
  const alreadyResolved = resolvedPackages.get(packageName);
  if (alreadyResolved) {
    logger.debug(`Package '${packageName}' already resolved to v${alreadyResolved.version} from ${alreadyResolved.source || 'unknown'}, validating constraints`);
    
    // Still need to validate version constraints even for pre-resolved packages
    // Gather all constraints for this package
    let allRanges: string[] = [];
    if (rootOverrides?.has(packageName)) {
      allRanges = [...(rootOverrides.get(packageName)!)];
    } else {
      if (version) allRanges.push(version);
      const globalRanges = globalConstraints?.get(packageName);
      if (globalRanges) allRanges.push(...globalRanges);
      const priorRanges = requiredVersions.get(packageName) || [];
      if (priorRanges.length > 0) allRanges.push(...priorRanges);
    }
    
    const dedupedRanges = Array.from(new Set(allRanges));
    const normalizedRanges = dedupedRanges.map(r => r.trim()).filter(Boolean);
    const isWildcardRange = (range: string) => {
      const normalized = range.toLowerCase();
      return normalized === '*' || normalized === 'latest';
    };
    const constraintRanges = normalizedRanges.filter(range => !isWildcardRange(range));
    
    // Validate existing version against constraints
    if (constraintRanges.length > 0) {
      const existingVersion = alreadyResolved.version;
      const allSatisfied = constraintRanges.every(range => {
        try {
          return semver.satisfies(existingVersion, range, { includePrerelease: true });
        } catch (error) {
          logger.debug(
            `Failed to evaluate semver for ${packageName}@${existingVersion} against range '${range}': ${error}`
          );
          return false;
        }
      });
      
      if (!allSatisfied) {
        // Version conflict with pre-resolved package
        const sourceDescription = alreadyResolved.source === 'path' ? 'local path' :
                                  alreadyResolved.source === 'git' ? 'git repository' :
                                  alreadyResolved.source || 'unknown source';
        const conflictMessage = `Package '${packageName}' was resolved to version ${existingVersion} (from ${sourceDescription}) but other dependencies require: ${constraintRanges.join(', ')}`;
        logger.error(conflictMessage);
        throw new VersionConflictError(packageName, {
          ranges: constraintRanges,
          availableVersions: [existingVersion]
        });
      }
      
      logger.debug(`Package '${packageName}' v${existingVersion} satisfies constraints: ${constraintRanges.join(', ')}`);
    }
    
    // Track required version if specified
    if (version) {
      if (!requiredVersions.has(packageName)) {
        requiredVersions.set(packageName, []);
      }
      requiredVersions.get(packageName)!.push(version);
    }
    
    // Constraints satisfied - process dependencies without re-loading package
    const pkg = alreadyResolved.pkg;
    const packageYmlFile =
      pkg.files.find(f => f.path === PACKAGE_PATHS.MANIFEST_RELATIVE) ||
      pkg.files.find(f => f.path === 'openpackage.yml');
    
    if (packageYmlFile) {
      const config = yaml.load(packageYmlFile.content) as PackageYml;
      
      // Recursively resolve dependencies
      visitedStack.add(packageName);
      
      // Only process 'dependencies' array (NOT 'dev-dependencies' for transitive dependencies)
      const dependencies = config.dependencies || [];
      
      // Determine the source directory for resolving relative paths
      const baseDir = currentPackageSourcePath ? dirname(currentPackageSourcePath) : targetDir;

      const resolveLocalPackage = async (
        pkg: Package,
        sourceType: 'git' | 'path',
        sourcePath: string,
        requiredRange?: string
      ) => {
        if (!resolvedPackages.has(pkg.metadata.name)) {
          resolvedPackages.set(pkg.metadata.name, {
            name: pkg.metadata.name,
            version: pkg.metadata.version || '0.0.0',
            pkg: pkg,
            isRoot: false,
            source: sourceType,
            contentRoot: sourcePath,
            requiredVersion: pkg.metadata.version,
            requiredRange
          });

          const child = await resolveDependencies(
            pkg.metadata.name,
            targetDir,
            false,
            visitedStack,
            resolvedPackages,
            pkg.metadata.version,
            requiredVersions,
            globalConstraints,
            rootOverrides,
            resolverOptions,
            remoteOutcomes,
            sourcePath
          );
          for (const m of child.missingPackages) missing.add(m);
        }
      };

      const processDependencyEntry = async (dep: any) => {
        // Git-based dependency - handle both new (url) and legacy (git) fields
        if (dep.url || dep.git) {
          const gitUrlRaw = dep.url || dep.git!;
          
          try {
            // Parse url field to extract ref if embedded
            const [gitUrl, embeddedRef] = gitUrlRaw.includes('#') 
              ? gitUrlRaw.split('#', 2)
              : [gitUrlRaw, undefined];
            
            // Use embedded ref if present, otherwise fall back to separate ref field
            const ref = embeddedRef || dep.ref;
            
            const result = await loadPackageFromGit({
              url: gitUrl,
              ref,
              skipCache: resolverOptions.skipCache
            });
            if (result.isMarketplace) {
              logger.error(`Dependency '${dep.name}' points to a Claude Code plugin marketplace, which cannot be used as a dependency`);
              missing.add(dep.name);
              return;
            }
            await resolveLocalPackage(result.pkg!, 'git', result.sourcePath, dep.version);
          } catch (error) {
            logger.error(`Failed to load git-based dependency '${dep.name}' from '${gitUrlRaw}': ${error}`);
            missing.add(dep.name);
          }
        } else if (dep.path) {
          // Resolve path relative to the current package's location
          const resolvedPath = resolve(baseDir, dep.path);
          
          try {
            // Load package from path
            const pathPackage = await loadPackageFromPath(resolvedPath);
            await resolveLocalPackage(pathPackage, 'path', resolvedPath, dep.version);
          } catch (error) {
            logger.error(`Failed to load path-based dependency '${dep.name}' from '${dep.path}': ${error}`);
            missing.add(dep.name);
          }
        } else {
          // Standard registry-based dependency resolution
          const child = await resolveDependencies(
            dep.name,
            targetDir,
            false,
            visitedStack,
            resolvedPackages,
            dep.version,
            requiredVersions,
            globalConstraints,
            rootOverrides,
            resolverOptions,
            remoteOutcomes
          );
          for (const m of child.missingPackages) missing.add(m);
        }
      };
      
      // Process regular packages
      for (const dep of dependencies) {
        await processDependencyEntry(dep);
      }
      
      // For root package, also process dev-dependencies
      if (isRoot) {
        const devDependencies = config['dev-dependencies'] || [];
        for (const dep of devDependencies) {
          await processDependencyEntry(dep);
        }
      }
      
      visitedStack.delete(packageName);
    }
    
    return buildResolveResult(resolvedPackages, missing, remoteOutcomes);
  }
  
  // 2. Resolve version range(s) to specific version if needed
  let resolvedVersion: string | undefined;
  let versionRange: string | undefined;
   // Track where the final selected version came from for UX purposes
  let resolutionSource: 'local' | 'remote' | undefined;

  // Precedence: root overrides (from root openpackage.yml) > combined constraints
  let allRanges: string[] = [];

  if (rootOverrides?.has(packageName)) {
    // Root openpackage.yml versions act as authoritative overrides
    allRanges = [...(rootOverrides.get(packageName)!)];
  } else {
    // No root override - combine all constraints
    if (version) {
      allRanges.push(version);
    }
    const globalRanges = globalConstraints?.get(packageName);
    if (globalRanges) {
      allRanges.push(...globalRanges);
    }
    const priorRanges = requiredVersions.get(packageName) || [];
    if (priorRanges.length > 0) {
      allRanges.push(...priorRanges);
    }
  }

  const dedupedRanges = Array.from(new Set(allRanges));
  const normalizedRanges = dedupedRanges.map(r => r.trim()).filter(Boolean);
  const isWildcardRange = (range: string) => {
    const normalized = range.toLowerCase();
    return normalized === '*' || normalized === 'latest';
  };
  const constraintRanges = normalizedRanges.filter(range => !isWildcardRange(range));
  const hasConstraints = constraintRanges.length > 0;
  const combinedRangeLabel = hasConstraints ? constraintRanges.join(' & ') : undefined;

  const filterAvailableVersions = (versions: string[]): string[] => {
    if (!hasConstraints) {
      return versions;
    }

    return versions.filter(versionCandidate => {
      return constraintRanges.every(range => {
        try {
          return semver.satisfies(versionCandidate, range, { includePrerelease: true });
        } catch (error) {
          logger.debug(
            `Failed to evaluate semver for ${packageName}@${versionCandidate} against range '${range}': ${error}`
          );
          return false;
        }
      });
    });
  };

  const localSources: CandidateVersionsResult = await resolveCandidateVersionsForInstall({
    cwd: targetDir,
    packageName,
    mode: resolutionMode
  });

  const mutableSourceVersion =
    localSources.sourceKind === 'workspaceMutable' || localSources.sourceKind === 'globalMutable'
      ? localSources.localVersions[0]
      : null;
  if (mutableSourceVersion && constraintRanges.length > 0) {
    const satisfies = constraintRanges.every(range =>
      semver.satisfies(mutableSourceVersion, range, { includePrerelease: true })
    );
    if (!satisfies) {
      throw new VersionConflictError(packageName, {
        ranges: constraintRanges,
        availableVersions: [mutableSourceVersion]
      });
    }
  }

  const localVersions = localSources.localVersions;
  const explicitPrereleaseIntent = allRanges.some(range => hasExplicitPrereleaseIntent(range));

  let selectionResult;
  try {
    selectionResult = await selectInstallVersionUnified({
      packageName,
      constraint: '*',
      mode: resolutionMode,
      explicitPrereleaseIntent,
      profile: resolverOptions.profile,
      apiKey: resolverOptions.apiKey,
      localVersions,
      filterAvailableVersions
    });
  } catch (error) {
    // In default (local-first with remote fallback) mode, a failure here almost
    // always means that remote metadata lookup failed (e.g. network error,
    // unreachable registry) while trying to fall back to remote. For local-first
    // semantics we should treat this as "remote unavailable" and continue with a
    // best-effort local resolution by marking this package as missing instead of
    // aborting the entire install.
    if (resolutionMode === 'default') {
      const message = error instanceof Error ? error.message : String(error);
      const reason = extractRemoteErrorReason(message);
      const warning = `Remote pull failed for \`${packageName}\` (reason: ${reason})`;

      logger.warn(warning);
      if (resolverOptions.onWarning) {
        resolverOptions.onWarning(warning);
      }

      let outcomeReason: PackageRemoteResolutionOutcome['reason'] = 'unknown';
      if (error && typeof error === 'object' && 'failure' in error && error.failure) {
        outcomeReason = (error.failure as { reason: PackageRemoteResolutionOutcome['reason'] }).reason;
      }
      remoteOutcomes.set(packageName, {
        name: packageName,
        reason: outcomeReason,
        message: warning
      });

      missing.add(packageName);
      return buildResolveResult(resolvedPackages, missing, remoteOutcomes);
    }

    // For non-default modes (e.g. remote-primary), remote metadata is required
    // and failures should still be treated as fatal.
    throw error;
  }

  if (selectionResult.sources.warnings.length > 0 && resolverOptions.onWarning) {
    selectionResult.sources.warnings.forEach(resolverOptions.onWarning);
  }

  const filteredAvailable = filterAvailableVersions(selectionResult.sources.availableVersions);

  if (!selectionResult.selectedVersion) {
    if (filteredAvailable.length > 0) {
      throw new VersionConflictError(packageName, {
        ranges: allRanges,
        availableVersions: selectionResult.sources.availableVersions
      });
    } else {
      missing.add(packageName);
      return buildResolveResult(resolvedPackages, missing, remoteOutcomes);
    }
  } else {
    resolvedVersion = selectionResult.selectedVersion;
  }

  versionRange = combinedRangeLabel;
  resolutionSource =
    selectionResult.resolutionSource ?? (resolutionMode === 'remote-primary' ? 'remote' : 'local');
  logger.debug(
    `Resolved constraints [${allRanges.join(', ')}] to '${resolvedVersion}' for package '${packageName}'`
  );

  const higherLocalWarning = await maybeWarnHigherRegistryVersion({
    packageName,
    selectedVersion: resolvedVersion
  });
  if (higherLocalWarning) {
    logger.warn(`⚠️  ${higherLocalWarning}`);
    if (resolverOptions.onWarning) {
      resolverOptions.onWarning(`⚠️  ${higherLocalWarning}`);
    }
  }

  if (!hasConstraints) {
    versionRange = undefined;
  }

  // 3. Attempt to repair dependency from local registry
  let pkg: Package;
  const contentRoot =
    localSources.contentRoot ??
    (await resolvePackageContentRoot({
      cwd: targetDir,
      packageName,
      version: resolvedVersion
    }));
  try {
    // Load package with resolved version
    logger.debug(`Attempting to load package '${packageName}' from local registry`, {
      version: resolvedVersion,
      originalRange: versionRange
    });
    pkg = await packageManager.loadPackage(packageName, resolvedVersion, { packageRootDir: contentRoot });
    logger.debug(`Successfully loaded package '${packageName}' from local registry`, {
      version: pkg.metadata.version
    });
  } catch (error) {
    if (error instanceof PackageNotFoundError) {
      // Auto-repair attempt: Check if package exists in registry but needs to be loaded
      logger.debug(`Package '${packageName}' not found in local registry, attempting repair`);

      try {
        // Check if package exists in registry (but files might be missing)
        // First try direct lookup (works for normalized names)
        let hasPackage = await getLatestPackageVersion(packageName) !== null;
        if (!hasPackage) {
          // If not found, try case-insensitive lookup
          const foundPackage = await findPackageByName(packageName);
          hasPackage = foundPackage !== null;
        }
        logger.debug(`Registry check for '${packageName}': hasPackage=${hasPackage}, requiredVersion=${version}`);

        if (hasPackage) {
          // Check if the resolved version exists (use resolvedVersion if available, otherwise fall back to version)
          const versionToCheck = resolvedVersion || version;
          if (versionToCheck) {
            const hasSpecificVersion = await hasPackageVersion(packageName, versionToCheck);
            if (!hasSpecificVersion) {
              // Package exists but not in the required/resolved version - treat as a missing dependency
              const dependencyChain = Array.from(visitedStack);
              const versionDisplay = versionRange || version || resolvedVersion;
              let warningMessage = `Package '${packageName}' exists in registry but version '${versionDisplay}' is not available\n\n`;

              if (dependencyChain.length > 0) {
                warningMessage += `✓ Dependency chain:\n`;
                for (let i = 0; i < dependencyChain.length; i++) {
                  const indent = '  '.repeat(i);
                  warningMessage += `${indent}└─ ${dependencyChain[i]}\n`;
                }
                warningMessage += `${'  '.repeat(dependencyChain.length)}└─ ${packageName}@${versionDisplay} ❌ (version not available)\n\n`;
              }

              warningMessage += `💡 To resolve this issue:\n`;
              warningMessage += `   • Install the available version: opkg install ${packageName}@latest\n`;
              warningMessage += `   • Update the dependency in openpackage.yml to use an available version\n`;

              // Surface as warning but do NOT abort the entire install – mark as missing instead.
              logger.warn(warningMessage);
              if (resolverOptions.onWarning) {
                resolverOptions.onWarning(warningMessage);
              }

              missing.add(packageName);
              return {
                resolvedPackages: Array.from(resolvedPackages.values()),
                missingPackages: Array.from(missing)
              };
            }
          }

          logger.info(`Found package '${packageName}' in registry, attempting repair`);
          // Attempt to load again with the resolved version - this might succeed if it was a temporary issue
          pkg = await packageManager.loadPackage(packageName, resolvedVersion || version, {
            packageRootDir: contentRoot
          });
          logger.info(`Successfully repaired and loaded package '${packageName}'`);
        } else {
          // Package truly doesn't exist - treat as missing dependency
          missing.add(packageName);
          return {
            resolvedPackages: Array.from(resolvedPackages.values()),
            missingPackages: Array.from(missing)
          };
        }
      } catch (repairError) {
        // Repair failed - treat as missing dependency instead of aborting the whole install flow
        const remoteOutcome = remoteOutcomes.get(packageName);
        const derivedReason = remoteOutcome ? formatRemoteOutcomeReason(remoteOutcome) : null;
        const fallbackReason = extractRemoteErrorReason(String(repairError));
        const reason = derivedReason ?? fallbackReason;
        if (remoteOutcome) {
          const warning = `Remote pull failed for \`${packageName}\` (reason: ${reason})`;
          logger.warn(warning);
          if (resolverOptions.onWarning) {
            resolverOptions.onWarning(warning);
          }
        } else {
          // Warning suppressed until remote outcome available
        }

        missing.add(packageName);
        return {
          resolvedPackages: Array.from(resolvedPackages.values()),
          missingPackages: Array.from(missing)
        };
      }
    } else {
      // Re-throw other errors
      throw error;
    }
  }

  // Use the resolved version (from directory name) rather than metadata version
  // This ensures WIP packages use their full version string (e.g., 1.0.0-000fz8.a3k)
  // instead of the base version from openpackage.yml (e.g., 1.0.0)
  const currentVersion = resolvedVersion;
  if (!currentVersion) {
    throw new Error(`Resolved version is undefined for package ${packageName}`);
  }
  
  // 3. Check for existing resolution
  const existing = resolvedPackages.get(packageName);
  if (existing) {
    const comparison = semver.compare(currentVersion, existing.version);
    
    if (comparison > 0) {
      // Current version is newer - prompt to overwrite
      const shouldOverwrite = await promptOverwrite(packageName, existing.version, currentVersion);
      if (shouldOverwrite) {
        existing.version = currentVersion;
        existing.pkg = pkg;
        existing.conflictResolution = 'overwritten';
      } else {
        existing.conflictResolution = 'skipped';
      }
    } else {
      // Existing version is same or newer - keep existing
      existing.conflictResolution = 'kept';
    }
    return buildResolveResult(resolvedPackages, missing, remoteOutcomes);
  }
  
  // 3.1. Check for already installed version in openpackage
  const installedVersion = await getInstalledPackageVersion(packageName, targetDir);
  if (installedVersion) {
    const comparison = semver.compare(currentVersion, installedVersion);
    
    if (comparison > 0) {
      // New version is greater than installed - allow installation but will prompt later
      logger.debug(`Package '${packageName}' will be upgraded from v${installedVersion} to v${currentVersion}`);
    } else if (comparison === 0) {
      // Same version - skip installation
      logger.debug(`Package '${packageName}' v${currentVersion} already installed, skipping`);
      resolvedPackages.set(packageName, {
        name: packageName,
        version: installedVersion,
        pkg,
        isRoot,
        contentRoot, // Track content root for consistent access
        conflictResolution: 'kept'
      });
      return buildResolveResult(resolvedPackages, missing, remoteOutcomes);
    } else {
      // New version is older than installed - skip installation
      logger.debug(`Package '${packageName}' has newer version installed (v${installedVersion} > v${currentVersion}), skipping`);
      resolvedPackages.set(packageName, {
        name: packageName,
        version: installedVersion,
        pkg,
        isRoot,
        contentRoot, // Track content root for consistent access
        conflictResolution: 'kept'
      });
      return buildResolveResult(resolvedPackages, missing, remoteOutcomes);
    }
  }
  
  // 4. Track required version if specified
  if (version) {
    if (!requiredVersions.has(packageName)) {
      requiredVersions.set(packageName, []);
    }
    requiredVersions.get(packageName)!.push(version);
  }

  // 5. Add to resolved map
  resolvedPackages.set(packageName, {
    name: packageName,
    version: currentVersion,
    pkg,
    isRoot,
    source: resolutionSource ?? 'local',
    contentRoot, // Track content root for workspace/global mutable sources
    requiredVersion: resolvedVersion, // Track the resolved version
    requiredRange: versionRange // Track the original range
  });
  
  // 5. Parse dependencies from package's openpackage.yml
  const packageYmlFile =
    pkg.files.find(f => f.path === PACKAGE_PATHS.MANIFEST_RELATIVE) ||
    pkg.files.find(f => f.path === 'openpackage.yml');
  if (packageYmlFile) {
    const config = yaml.load(packageYmlFile.content) as PackageYml;
    
    // 6. Recursively resolve dependencies
    visitedStack.add(packageName);
    
    // Only process 'dependencies' array (NOT 'dev-dependencies' for transitive dependencies)
    const dependencies = config.dependencies || [];
    
    // Determine the source directory for resolving relative paths
    // If currentPackageSourcePath is provided, use its directory; otherwise use targetDir
    const baseDir = currentPackageSourcePath ? dirname(currentPackageSourcePath) : targetDir;

    const resolveLocalPackage = async (
      pkg: Package,
      sourceType: 'git' | 'path',
      sourcePath: string,
      requiredRange?: string
    ) => {
      if (!resolvedPackages.has(pkg.metadata.name)) {
        resolvedPackages.set(pkg.metadata.name, {
          name: pkg.metadata.name,
          version: pkg.metadata.version || '0.0.0',
          pkg: pkg,
          isRoot: false,
          source: sourceType,
          contentRoot: sourcePath,
          requiredVersion: pkg.metadata.version,
          requiredRange
        });

        const child = await resolveDependencies(
          pkg.metadata.name,
          targetDir,
          false,
          visitedStack,
          resolvedPackages,
          pkg.metadata.version,
          requiredVersions,
          globalConstraints,
          rootOverrides,
          resolverOptions,
          remoteOutcomes,
          sourcePath
        );
        for (const m of child.missingPackages) missing.add(m);
      }
    };

    const processDependencyEntry = async (dep: any) => {
      // Git-based dependency - handle both new (url) and legacy (git) fields
      if (dep.url || dep.git) {
        const gitUrlRaw = dep.url || dep.git!;
        
        try {
          // Parse url field to extract ref if embedded
          const [gitUrl, embeddedRef] = gitUrlRaw.includes('#') 
            ? gitUrlRaw.split('#', 2)
            : [gitUrlRaw, undefined];
          
          // Use embedded ref if present, otherwise fall back to separate ref field
          const ref = embeddedRef || dep.ref;
          
          const result = await loadPackageFromGit({
            url: gitUrl,
            ref,
            skipCache: resolverOptions.skipCache
          });
          if (result.isMarketplace) {
            logger.error(`Dependency '${dep.name}' points to a Claude Code plugin marketplace, which cannot be used as a dependency`);
            missing.add(dep.name);
            return;
          }
          await resolveLocalPackage(result.pkg!, 'git', result.sourcePath, dep.version);
        } catch (error) {
          logger.error(`Failed to load git-based dependency '${dep.name}' from '${gitUrlRaw}': ${error}`);
          missing.add(dep.name);
        }
      } else if (dep.path) {
        // Resolve path relative to the current package's location
        const resolvedPath = resolve(baseDir, dep.path);
        
        try {
          // Load package from path
          const pathPackage = await loadPackageFromPath(resolvedPath);
          await resolveLocalPackage(pathPackage, 'path', resolvedPath, dep.version);
        } catch (error) {
          logger.error(`Failed to load path-based dependency '${dep.name}' from '${dep.path}': ${error}`);
          missing.add(dep.name);
        }
      } else {
        // Standard registry-based dependency resolution
        const child = await resolveDependencies(
          dep.name,
          targetDir,
          false,
          visitedStack,
          resolvedPackages,
          dep.version,
          requiredVersions,
          globalConstraints,
          rootOverrides,
          resolverOptions,
          remoteOutcomes
        );
        for (const m of child.missingPackages) missing.add(m);
      }
    };
    
    // Process regular packages
    for (const dep of dependencies) {
      await processDependencyEntry(dep);
    }
    
    // For root package, also process dev-dependencies
    if (isRoot) {
      const devDependencies = config['dev-dependencies'] || [];
      for (const dep of devDependencies) {
        await processDependencyEntry(dep);
      }
    }
    
    visitedStack.delete(packageName);

  }
  
  // Attach the requiredVersions map to each resolved package for later use
  const resolvedArray = Array.from(resolvedPackages.values());
  for (const resolved of resolvedArray) {
    (resolved as any).requiredVersions = requiredVersions;
  }
  return buildResolveResult(resolvedPackages, missing, remoteOutcomes);
}

function buildResolveResult(
  resolvedPackages: Map<string, ResolvedPackage>,
  missing: Set<string>,
  remoteOutcomes: Map<string, PackageRemoteResolutionOutcome>
): ResolveDependenciesResult {
  const resolvedArray = Array.from(resolvedPackages.values());
  const outcomesRecord =
    remoteOutcomes.size > 0 ? Object.fromEntries(remoteOutcomes) : undefined;

  return {
    resolvedPackages: resolvedArray,
    missingPackages: Array.from(missing),
    remoteOutcomes: outcomesRecord
  };
}

function formatRemoteOutcomeReason(outcome: PackageRemoteResolutionOutcome): string {
  switch (outcome.reason) {
    case 'not-found':
      return 'not found in remote registry';
    case 'access-denied':
      return 'access denied';
    case 'network':
      return 'network error';
    case 'integrity':
      return 'integrity check failed';
    default:
      return extractRemoteErrorReason(outcome.message || 'unknown error');
  }
}
