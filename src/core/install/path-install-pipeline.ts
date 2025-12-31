import type { CommandResult, InstallOptions } from '../../types/index.js';
import type { ResolvedPackage } from '../dependency-resolver.js';
import type { PackageRemoteResolutionOutcome } from './types.js';
import type { Platform } from '../platforms.js';
import { displayDependencyTree } from '../dependency-resolver.js';
import { ensureRegistryDirectories } from '../directory.js';
import {
  prepareInstallEnvironment,
  processConflictResolution,
  performIndexBasedInstallationPhases,
  VersionResolutionAbortError
} from './install-flow.js';
import { handleDryRunMode } from './dry-run.js';
import { displayInstallationResults, formatSelectionSummary } from './install-reporting.js';
import { resolvePlatforms } from './platform-resolution.js';
import { getLocalPackageYmlPath, getInstallRootDir, isRootPackage } from '../../utils/paths.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { PackageNotFoundError } from '../../utils/errors.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { loadPackageFromPath } from './path-package-loader.js';
import {
  createWorkspacePackageYml,
  addPackageToYml,
} from '../../utils/package-management.js';
import { determineResolutionMode } from './install-pipeline.js';

export interface PathInstallPipelineOptions extends InstallOptions {
  sourcePath: string;     // Absolute path to local package directory or tarball
  sourceType: 'directory' | 'tarball';
  targetDir: string;
  gitUrl?: string;
  gitRef?: string;
}

export interface PathInstallPipelineResult {
  packageName: string;
  targetDir: string;
  resolvedPackages: ResolvedPackage[];
  totalPackages: number;
  installed: number;
  skipped: number;
  totalOpenPackageFiles: number;
  sourcePath: string;
  sourceType: 'directory' | 'tarball';
}

/**
 * Install a package from a local directory or tarball path.
 * 
 * Flow:
 * 1. Load package from path
 * 2. Resolve dependencies recursively (handles path-based deps)
 * 3. Copy to workspace .openpackage/packages/ for consistency
 * 4. Install to workspace platforms
 * 5. Update workspace openpackage.yml with path field
 */
export async function runPathInstallPipeline(
  options: PathInstallPipelineOptions
): Promise<CommandResult<PathInstallPipelineResult>> {
  const cwd = process.cwd();
  const resolutionMode = determineResolutionMode(options);
  const dryRun = Boolean(options.dryRun);
  const warnings: string[] = [];
  const warnedPackages = new Set<string>();

  // Load package from path
  logger.debug(`Loading package from ${options.sourceType}: ${options.sourcePath}`);
  let sourcePackage;
  try {
    sourcePackage = await loadPackageFromPath(options.sourcePath);
  } catch (error) {
    return {
      success: false,
      error: `Failed to load package from ${options.sourceType} '${options.sourcePath}': ${error}`
    };
  }

  const packageName = sourcePackage.metadata.name;
  const packageVersion = sourcePackage.metadata.version || '0.0.0';

  // Check for root package conflict
  if (await isRootPackage(cwd, packageName)) {
    console.log(`⚠️  Cannot install ${packageName} - it matches your project's root package name`);
    console.log(`   This would create a circular dependency.`);
    return {
      success: true,
      data: {
        packageName,
        targetDir: getInstallRootDir(cwd),
        resolvedPackages: [],
        totalPackages: 0,
        installed: 0,
        skipped: 1,
        totalOpenPackageFiles: 0,
        sourcePath: options.sourcePath,
        sourceType: options.sourceType
      }
    };
  }

  await ensureRegistryDirectories();
  await createWorkspacePackageYml(cwd);

  // Resolve dependencies (this will handle path-based dependencies recursively)
  const resolveDependenciesOutcome = async (): Promise<
    | { success: true; data: { resolvedPackages: ResolvedPackage[]; missingPackages: string[]; remoteOutcomes?: Record<string, PackageRemoteResolutionOutcome>; warnings?: string[] } }
    | { success: false; commandResult: CommandResult<PathInstallPipelineResult> }
  > => {
    try {
      // First, add the source package to resolved packages
      const resolvedPackages = new Map<string, ResolvedPackage>();
      resolvedPackages.set(packageName, {
        name: packageName,
        version: packageVersion,
        pkg: sourcePackage,
        isRoot: true,
        source: 'path'
      });

      // Resolve dependencies from the source package
      // We need to manually resolve dependencies since resolveDependenciesForInstall expects a registry package
      const { resolveDependencies } = await import('../dependency-resolver.js');
      const { gatherGlobalVersionConstraints, gatherRootVersionConstraints } = await import('../openpackage.js');
      
      const globalConstraints = await gatherGlobalVersionConstraints(cwd);
      const rootConstraints = await gatherRootVersionConstraints(cwd);
      const rootOverrides = new Map(rootConstraints);

      const resolverOptions = {
        mode: resolutionMode,
        profile: options.profile,
        apiKey: options.apiKey,
        preferStable: options.stable ?? false,
        onWarning: (message: string) => {
          warnings.push(message);
          console.log(`⚠️  ${message}`);
        }
      };

      // Resolve dependencies, passing the source path for relative resolution
      const depResult = await resolveDependencies(
        packageName,
        cwd,
        true,
        new Set(),  // Empty visitedStack - resolveDependencies manages this internally
        resolvedPackages,
        packageVersion,
        new Map(),
        globalConstraints,
        rootOverrides,
        resolverOptions,
        new Map(),
        options.sourcePath  // Pass source path for relative dependency resolution
      );

      return {
        success: true,
        data: {
          resolvedPackages: Array.from(resolvedPackages.values()),
          missingPackages: Array.from(depResult.missingPackages),
          remoteOutcomes: depResult.remoteOutcomes,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      };
    } catch (error) {
      if (error instanceof VersionResolutionAbortError) {
        return {
          success: false,
          commandResult: { success: false, error: error.message }
        };
      }

      if (
        error instanceof PackageNotFoundError ||
        (error instanceof Error &&
          (error.message.includes('not available in local registry') ||
            (error.message.includes('Package') && error.message.includes('not found'))))
      ) {
        console.log('❌ Package not found');
        return { success: false, commandResult: { success: false, error: 'Package not found' } };
      }

      throw error;
    }
  };

  const initialResolution = await resolveDependenciesOutcome();
  if (!initialResolution.success) {
    return initialResolution.commandResult;
  }

  let resolvedPackages = initialResolution.data.resolvedPackages;
  let missingPackages = initialResolution.data.missingPackages;
  const remoteOutcomes: Record<string, PackageRemoteResolutionOutcome> = initialResolution.data.remoteOutcomes || {};

  if (missingPackages.length > 0) {
    const missingSummary = `Missing packages: ${Array.from(new Set(missingPackages)).join(', ')}`;
    console.log(`⚠️  ${missingSummary}`);
    warnings.push(missingSummary);
  }

  // Display selection summary
  console.log(formatSelectionSummary('path', packageName, packageVersion));

  const { specifiedPlatforms } = await prepareInstallEnvironment(cwd, options);

  const conflictProcessing = await processConflictResolution(resolvedPackages, options);
  if ('cancelled' in conflictProcessing) {
    console.log(`Installation cancelled by user`);
    return {
      success: true,
      data: {
        packageName,
        targetDir: getInstallRootDir(cwd),
        resolvedPackages: [],
        totalPackages: 0,
        installed: 0,
        skipped: 1,
        totalOpenPackageFiles: 0,
        sourcePath: options.sourcePath,
        sourceType: options.sourceType
      }
    };
  }

  const { finalResolvedPackages, conflictResult } = conflictProcessing;
  displayDependencyTree(finalResolvedPackages, true);

  const packageYmlPath = getLocalPackageYmlPath(cwd);
  const packageYmlExists = await exists(packageYmlPath);

  if (dryRun) {
    // For dry run, we still need to write the package to workspace for consistency
    // but we'll use the standard dry run handler
    return await handleDryRunMode(
      finalResolvedPackages,
      packageName,
      options.targetDir,
      options,
      packageYmlExists
    ) as CommandResult<PathInstallPipelineResult>;
  }

  const canPromptForPlatforms = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const finalPlatforms = options.resolvedPlatforms && options.resolvedPlatforms.length > 0
    ? options.resolvedPlatforms
    : await resolvePlatforms(cwd, specifiedPlatforms, { interactive: canPromptForPlatforms });

  // TODO: Removed manual source copy to .openpackage/packages/ as redundant with index-based install
  // Source files handled via installPackageByIndex; index tracks mappings
  // If local cache needed for path sources, register to registry minimally instead
  const { getLocalPackageDir } = await import('../../utils/paths.js'); // Keep import if needed elsewhere
  logger.debug('Skipped manual source package copy to local packages dir', { packageName, sourcePath: options.sourcePath });


  // Install to workspace platforms
  const installationOutcome = await performIndexBasedInstallationPhases({
    cwd,
    packages: finalResolvedPackages,
    platforms: finalPlatforms as Platform[],
    conflictResult,
    options,
    targetDir: options.targetDir,
    fileFilters: undefined  // Full install for path-based packages
  });

  // Update workspace openpackage.yml with path-based dependency
  const mainPackage = finalResolvedPackages.find(pkg => pkg.isRoot);
  if (packageYmlExists && mainPackage) {
    // Store relative path if possible, otherwise absolute
    const relativePath = normalizePathForProcessing(options.sourcePath);
    const pathToStore = relativePath.startsWith('..') || relativePath.startsWith('/')
      ? relativePath
      : `./${relativePath}`;

    await addPackageToYml(
      cwd,
      packageName,
      packageVersion,
      options.dev ?? false,
      undefined,  // No range for path-based packages
      true,
      undefined,  // No include filter
      options.gitUrl ? undefined : pathToStore,  // Store the path when not git
      options.gitUrl,
      options.gitRef
    );
  }

  displayInstallationResults(
    packageName,
    finalResolvedPackages,
    { platforms: finalPlatforms, created: [] },
    options,
    mainPackage,
    installationOutcome.allAddedFiles,
    installationOutcome.allUpdatedFiles,
    installationOutcome.rootFileResults,
    missingPackages,
    remoteOutcomes
  );

  return {
    success: true,
    data: {
      packageName,
      targetDir: getInstallRootDir(cwd),
      resolvedPackages: finalResolvedPackages,
      totalPackages: finalResolvedPackages.length,
      installed: installationOutcome.installedCount,
      skipped: installationOutcome.skippedCount,
      totalOpenPackageFiles: installationOutcome.totalOpenPackageFiles,
      sourcePath: options.sourcePath,
      sourceType: options.sourceType
    },
    warnings: warnings.length > 0 ? Array.from(new Set(warnings)) : undefined
  };
}

