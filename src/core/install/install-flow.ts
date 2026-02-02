import * as semver from 'semver';
import { InstallOptions } from '../../types/index.js';
import { ResolvedPackage } from '../dependency-resolver.js';
import { ensureRegistryDirectories } from '../directory.js';
import { type Platform } from '../platforms.js';
import { gatherGlobalVersionConstraints, gatherRootVersionConstraints } from '../openpackage.js';
import { resolveDependencies } from '../dependency-resolver.js';
import { PackageRemoteResolutionOutcome } from './types.js';
import { logger } from '../../utils/logger.js';
import { VersionConflictError, UserCancellationError } from '../../utils/errors.js';
import { normalizePlatforms } from '../../utils/platform-mapper.js';
import { createWorkspacePackageYml } from '../../utils/package-management.js';
import { checkAndHandleAllPackageConflicts } from './operations/conflict-handler.js';
import { discoverAndCategorizeFiles } from './helpers/file-discovery.js';
import { installOrSyncRootFiles } from './operations/root-files.js';
import { installPackageByIndexWithFlows as installPackageByIndex, type IndexInstallResult } from '../../utils/flow-index-installer.js';
import { promptVersionSelection } from '../../utils/prompts.js';
import { ensureDir, exists, writeTextFile } from '../../utils/fs.js';
import { dirname, join } from 'path';

export interface DependencyResolutionResult {
  resolvedPackages: ResolvedPackage[];
  missingPackages: string[];
  warnings?: string[];
  remoteOutcomes?: Record<string, PackageRemoteResolutionOutcome>;
}

export class VersionResolutionAbortError extends Error {
  constructor(public packageName: string) {
    super(`Unable to resolve version for ${packageName}`);
    this.name = 'VersionResolutionAbortError';
  }
}

export interface ConflictProcessingResult {
  finalResolvedPackages: ResolvedPackage[];
  conflictResult: ConflictSummary;
}

export interface InstallationPhasesParams {
  cwd: string;
  packages: ResolvedPackage[];
  platforms: Platform[];
  conflictResult: ConflictSummary;
  options: InstallOptions;
  targetDir: string;
  fileFilters?: Record<string, string[] | undefined>;
  matchedPattern?: string;  // Phase 4: Pattern from base detection
}

export interface InstallationPhasesResult {
  installedCount: number;
  skippedCount: number;
  errorCount: number;
  allAddedFiles: string[];
  allUpdatedFiles: string[];
  rootFileResults: { installed: string[]; updated: string[]; skipped: string[] };
  totalOpenPackageFiles: number;
  errors?: string[];
}

type ConflictSummary = Awaited<ReturnType<typeof checkAndHandleAllPackageConflicts>>;

/**
 * Prepare the installation environment by ensuring directories and basic files exist
 */
export async function prepareInstallEnvironment(
  cwd: string,
  options: InstallOptions
): Promise<{ specifiedPlatforms: string[] | undefined }> {
  await ensureRegistryDirectories();
  await createWorkspacePackageYml(cwd);

  const specifiedPlatforms = normalizePlatforms(options.platforms);

  return { specifiedPlatforms };
}

/**
 * Resolve dependencies for installation with version conflict handling
 */
export async function resolveDependenciesForInstall(
  packageName: string,
  cwd: string,
  version: string | undefined,
  options: InstallOptions
): Promise<DependencyResolutionResult> {
  const globalConstraints = await gatherGlobalVersionConstraints(cwd);
  const rootConstraints = await gatherRootVersionConstraints(cwd);
  const rootOverrides = new Map(rootConstraints);
  const resolverWarnings = new Set<string>();

  const resolverOptions = {
    mode: options.resolutionMode ?? 'default',
    profile: options.profile,
    apiKey: options.apiKey,
    onWarning: (message: string) => {
      if (!resolverWarnings.has(message)) {
        resolverWarnings.add(message);
      }
    }
  };

  const runResolution = async () => {
    return await resolveDependencies(
      packageName,
      cwd,
      true,
      new Set(),
      new Map(),
      version,
      new Map(),
      globalConstraints,
      rootOverrides,
      resolverOptions
    );
  };

  try {
    const result = await runResolution();
    return {
      resolvedPackages: result.resolvedPackages,
      missingPackages: result.missingPackages,
      warnings: resolverWarnings.size > 0 ? Array.from(resolverWarnings) : undefined,
      remoteOutcomes: result.remoteOutcomes
    };
  } catch (error) {
    if (error instanceof VersionConflictError) {
      const conflictDetails: any = (error as any).details || {};
      const conflictName = conflictDetails.packageName || conflictDetails.pkg || packageName;
      const available: string[] = conflictDetails.availableVersions || [];

      let chosenVersion: string | null = null;
      if (options.force) {
        chosenVersion = [...available].sort((a, b) => semver.rcompare(a, b))[0] || null;
      } else {
        chosenVersion = await promptVersionSelection(conflictName, available, 'to install');
      }

      if (!chosenVersion) {
        throw new VersionResolutionAbortError(conflictName);
      }

      rootOverrides.set(conflictName, [chosenVersion]);
      const retryResult = await runResolution();
      return {
        resolvedPackages: retryResult.resolvedPackages,
        missingPackages: retryResult.missingPackages,
        warnings: resolverWarnings.size > 0 ? Array.from(resolverWarnings) : undefined,
        remoteOutcomes: retryResult.remoteOutcomes
      };
    }

    throw error;
  }
}

/**
 * Process conflict resolution for all packages in the dependency tree
 */
export async function processConflictResolution(
  resolvedPackages: ResolvedPackage[],
  options: InstallOptions
): Promise<ConflictProcessingResult | { cancelled: true }> {
  const conflictResult = await checkAndHandleAllPackageConflicts(resolvedPackages as any, options);

  if (!conflictResult.shouldProceed) {
    return { cancelled: true };
  }

  const finalResolvedPackages = resolvedPackages.filter(pkg => !conflictResult.skippedPackages.includes(pkg.name));

  return { finalResolvedPackages, conflictResult };
}


/**
 * Perform the index-based installation process
 */
export async function performIndexBasedInstallationPhases(params: InstallationPhasesParams): Promise<InstallationPhasesResult> {
  const { cwd, packages, platforms, conflictResult, options, targetDir, fileFilters, matchedPattern } = params;

  // Install each package using index-based installer
  let totalInstalled = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allAddedFiles: string[] = [];
  const allUpdatedFiles: string[] = [];
  const allDeletedFiles: string[] = [];
  const errors: string[] = [];

  for (const resolved of packages) {
    try {
      logger.debug(`Installing ${resolved.name}@${resolved.version} using index-based installer`);

      const filtersForPackage = fileFilters?.[resolved.name];
      const installResult: IndexInstallResult = await installPackageByIndex(
        cwd,
        resolved.name,
        resolved.version,
        platforms,
        options,
        filtersForPackage,
        resolved.contentRoot,  // Pass contentRoot for path-based packages
        resolved.pkg._format,   // Pass format metadata from Package object
        resolved.marketplaceMetadata,  // Pass marketplace metadata if present
        matchedPattern  // Phase 4: Pass matched pattern for filtering
      );

      totalInstalled += installResult.installed;
      totalUpdated += installResult.updated;
      totalDeleted += installResult.deleted;
      totalSkipped += installResult.skipped;

      allAddedFiles.push(...installResult.installedFiles);
      allUpdatedFiles.push(...installResult.updatedFiles);
      allDeletedFiles.push(...installResult.deletedFiles);

      if (installResult.installed > 0 || installResult.updated > 0 || installResult.deleted > 0) {
        logger.info(`Index-based install for ${resolved.name}: ${installResult.installed} installed, ${installResult.updated} updated, ${installResult.deleted} deleted`);
      }
    } catch (error) {
      if (error instanceof UserCancellationError) {
        throw error; // Re-throw to allow clean exit
      }
      const errorMsg = `Failed index-based install for ${resolved.name}: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
      totalErrors++;
    }
  }

  // Handle root files separately
  const rootFileResults = {
    installed: new Set<string>(),
    updated: new Set<string>(),
    skipped: new Set<string>()
  };

  for (const resolved of packages) {
    try {
      const filtersForPackage = fileFilters?.[resolved.name];
      const categorized = await discoverAndCategorizeFiles(
        resolved.name,
        resolved.version,
        platforms,
        filtersForPackage,
        resolved.contentRoot,  // Pass contentRoot for path-based packages
        matchedPattern  // Phase 4: Pass matched pattern for filtering
      );
      const installResult = await installOrSyncRootFiles(
        cwd,
        resolved.name,
        categorized.rootFiles,
        platforms
      );

      installResult.created.forEach(file => rootFileResults.installed.add(file));
      installResult.updated.forEach(file => rootFileResults.updated.add(file));
      installResult.skipped.forEach(file => rootFileResults.skipped.add(file));

      // Copy root/** files directly to workspace root (strip prefix)
      for (const file of categorized.rootCopyFiles) {
        const targetPath = join(cwd, file.path);
        const parent = dirname(targetPath);
        await ensureDir(parent);
        const existed = await exists(targetPath);
        await writeTextFile(targetPath, file.content, (file.encoding as BufferEncoding) ?? 'utf8');
        if (existed) {
          rootFileResults.updated.add(file.path);
        } else {
          rootFileResults.installed.add(file.path);
        }
      }
    } catch (error) {
      if (error instanceof UserCancellationError) {
        throw error; // Re-throw to allow clean exit
      }
      const errorMsg = `Failed root file install for ${resolved.name}: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
      totalErrors++;
    }
  }

  return {
    installedCount: totalInstalled,
    skippedCount: totalSkipped,
    errorCount: totalErrors,
    allAddedFiles,
    errors: errors.length > 0 ? errors : undefined,
    allUpdatedFiles,
    rootFileResults: {
      installed: Array.from(rootFileResults.installed),
      updated: Array.from(rootFileResults.updated),
      skipped: Array.from(rootFileResults.skipped)
    },
    totalOpenPackageFiles: totalInstalled + totalUpdated
  };
}



