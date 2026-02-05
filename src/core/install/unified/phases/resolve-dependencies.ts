import * as semver from 'semver';
import type { InstallationContext } from '../context.js';
import { pullMissingDependenciesIfNeeded } from '../../remote-flow.js';
import { addWarning, addError } from '../context-helpers.js';
import { logger } from '../../../../utils/logger.js';
import { resolveDependencies } from '../../../dependency-resolver/resolver.js';
import { gatherGlobalVersionConstraints, gatherRootVersionConstraints } from '../../../openpackage.js';
import { VersionConflictError } from '../../../../utils/errors.js';
import { promptVersionSelection } from '../../../../utils/prompts.js';
import type { PackageRemoteResolutionOutcome } from '../../types.js';

interface DependencyResolutionResult {
  resolvedPackages: Awaited<ReturnType<typeof resolveDependencies>>['resolvedPackages'];
  missingPackages: string[];
  warnings?: string[];
  remoteOutcomes?: Record<string, PackageRemoteResolutionOutcome>;
}

class VersionResolutionAbortError extends Error {
  constructor(public packageName: string) {
    super(`Unable to resolve version for ${packageName}`);
    this.name = 'VersionResolutionAbortError';
  }
}

async function resolveDependenciesForInstall(
  packageName: string,
  cwd: string,
  version: string | undefined,
  options: InstallationContext['options']
): Promise<DependencyResolutionResult> {
  const globalConstraints = await gatherGlobalVersionConstraints(cwd);
  const rootConstraints = await gatherRootVersionConstraints(cwd);
  const rootOverrides = new Map(rootConstraints);
  const resolverWarnings = new Set<string>();

  const resolverOptions = {
    mode: options.resolutionMode ?? 'default',
    profile: options.profile,
    apiKey: options.apiKey,
    skipCache: options.resolutionMode === 'remote-primary',
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
 * Resolve dependencies phase
 */
export async function resolveDependenciesPhase(ctx: InstallationContext): Promise<void> {
  logger.debug(`Resolving dependencies for ${ctx.source.packageName}`);
  
  try {
    // Initial dependency resolution
    const result = await resolveDependenciesForInstall(
      ctx.source.packageName,
      ctx.targetDir,
      ctx.source.version,
      ctx.options
    );
    
    // Add warnings
    result.warnings?.forEach(w => addWarning(ctx, w));
    
    // Update context
    ctx.resolvedPackages = result.resolvedPackages;
    let missingPackages = result.missingPackages;
    
    // Pull missing dependencies if needed
    if (missingPackages.length > 0 && ctx.options.resolutionMode !== 'local-only') {
      const pullResult = await pullMissingDependenciesIfNeeded({
        missingPackages,
        resolvedPackages: ctx.resolvedPackages,
        remoteOutcomes: result.remoteOutcomes || {},
        warnedPackages: new Set(),
        dryRun: ctx.options.dryRun || false,
        profile: ctx.options.profile,
        apiKey: ctx.options.apiKey
      });
      
      pullResult.warnings.forEach(w => addWarning(ctx, w));
      
      // Re-resolve if we pulled anything
      if (pullResult.pulledAny) {
        const refreshed = await resolveDependenciesForInstall(
          ctx.source.packageName,
          ctx.targetDir,
          ctx.source.version,
          ctx.options
        );
        
        ctx.resolvedPackages = refreshed.resolvedPackages;
        missingPackages = refreshed.missingPackages;
      }
    }
    
    // Warn about remaining missing packages
    if (missingPackages.length > 0) {
      const warning = `Missing packages: ${Array.from(new Set(missingPackages)).join(', ')}`;
      addWarning(ctx, warning);
    }
    
    logger.info(`Resolved ${ctx.resolvedPackages.length} packages`);
    
  } catch (error) {
    const errorMsg = `Failed to resolve dependencies: ${error}`;
    addError(ctx, errorMsg);
    throw new Error(errorMsg);
  }
}
