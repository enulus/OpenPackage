import type { InstallationContext } from '../context.js';
import { performIndexBasedInstallationPhases } from '../../install-flow.js';
import { displayDependencyTree } from '../../../dependency-resolver.js';
import { resolvePlatforms } from '../../platform-resolution.js';
import { logger } from '../../../../utils/logger.js';

export interface ExecutionResult {
  installedCount: number;
  skippedCount: number;
  errorCount: number;
  allAddedFiles: string[];
  allUpdatedFiles: string[];
  rootFileResults: { installed: string[]; updated: string[]; skipped: string[] };
  hadErrors: boolean;
  installedAnyFiles: boolean;
  errors?: string[];
}

/**
 * Execute installation phase
 */
export async function executeInstallationPhase(
  ctx: InstallationContext
): Promise<ExecutionResult> {
  logger.debug(`Executing installation for ${ctx.resolvedPackages.length} packages`);
  
  // Display dependency tree
  displayDependencyTree(ctx.resolvedPackages, true);
  
  // Resolve platforms if not already set
  if (ctx.platforms.length === 0) {
    const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    ctx.platforms = await resolvePlatforms(
      ctx.cwd,
      ctx.options.platforms,
      { interactive: canPrompt }
    );
  }
  
  // Get conflict result from context
  const conflictResult = (ctx as any).conflictResult;
  
  // Phase 4: Build file filters for filtered resource installation
  const fileFilters = buildFileFilters(ctx);
  
  // Execute installation
  const outcome = await performIndexBasedInstallationPhases({
    cwd: ctx.cwd,
    packages: ctx.resolvedPackages,
    platforms: ctx.platforms,
    conflictResult,
    options: ctx.options,
    targetDir: ctx.targetDir,
    fileFilters,  // Pass filters to installation phases
    matchedPattern: ctx.matchedPattern  // Phase 4: Pass matched pattern
  });
  
  // Track errors in context
  outcome.errors?.forEach(e => ctx.errors.push(e));
  
  const hadErrors = outcome.errorCount > 0;
  const installedAnyFiles =
    outcome.allAddedFiles.length > 0 ||
    outcome.allUpdatedFiles.length > 0 ||
    outcome.rootFileResults.installed.length > 0 ||
    outcome.rootFileResults.updated.length > 0;
  
  return {
    ...outcome,
    hadErrors,
    installedAnyFiles,
    errors: outcome.errors
  };
}

/**
 * Build file filters from filtered resources (Phase 4: Resource model).
 * 
 * When convenience options are used (--agents, --skills), we need to tell
 * the flow installer which specific files to install.
 */
function buildFileFilters(ctx: InstallationContext): Record<string, string[] | undefined> {
  const fileFilters: Record<string, string[] | undefined> = {};
  
  // If no filtered resources, return empty filters (install everything)
  if (!ctx.filteredResources || ctx.filteredResources.length === 0) {
    return fileFilters;
  }
  
  // Build filter list for the root package
  const rootPackage = ctx.resolvedPackages.find(pkg => pkg.isRoot);
  if (!rootPackage) {
    return fileFilters;
  }
  
  // Extract paths to install from filtered resources
  const includePaths: string[] = [];
  
  for (const resource of ctx.filteredResources) {
    // For skills with installDir, include the entire directory
    if (resource.installDir) {
      // Make path relative to base
      const contentRoot = ctx.detectedBase || ctx.source.contentRoot || '';
      const relativePath = resource.installDir.startsWith(contentRoot)
        ? resource.installDir.substring(contentRoot.length).replace(/^\//, '')
        : resource.installDir;
      
      includePaths.push(relativePath);
      logger.debug('Added skill directory to filter', { resource: resource.name, path: relativePath });
    } else {
      // For agents, include the specific file
      const contentRoot = ctx.detectedBase || ctx.source.contentRoot || '';
      const relativePath = resource.path.startsWith(contentRoot)
        ? resource.path.substring(contentRoot.length).replace(/^\//, '')
        : resource.path;
      
      includePaths.push(relativePath);
      logger.debug('Added agent file to filter', { resource: resource.name, path: relativePath });
    }
  }
  
  // Store filters for the root package
  if (includePaths.length > 0) {
    fileFilters[rootPackage.name] = includePaths;
    logger.info(`Filtered installation: ${includePaths.length} paths for ${rootPackage.name}`);
  }
  
  return fileFilters;
}
