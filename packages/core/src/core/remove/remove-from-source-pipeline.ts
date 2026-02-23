import { resolve as resolvePath, join } from 'path';

import type { CommandResult } from '../../types/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import { assertMutableSourceOrThrow } from '../source-mutability.js';
import { collectRemovalEntries, type RemovalEntry } from './removal-collector.js';
import { classifyRemoveInput } from './remove-input-classifier.js';
import { runRemoveDependencyFlow } from './remove-dependency-flow.js';
import { confirmRemoval } from './removal-confirmation.js';
import { exists, remove } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { UserCancellationError } from '../../utils/errors.js';
import { cleanupEmptyParents } from '../../utils/cleanup-empty-parents.js';
import { resolveSourceOperationArguments } from '../../utils/source-operation-arguments.js';
import { buildWorkspacePackageContext } from '../workspace-package-context.js';
import { withRichOutput } from '../ports/resolve.js';

export interface RemoveFromSourceOptions {
  force?: boolean;
  dryRun?: boolean;
  execContext?: ExecutionContext;
  /** Called before confirmation prompt (for non-interactive: show header before "Confirm removal?") */
  beforeConfirm?: (info: { packageName: string; sourcePath: string }) => void;
}

export interface RemoveFromSourceResult {
  packageName: string;
  filesRemoved: number;
  sourcePath: string;
  sourceType: 'workspace' | 'global';
  removedPaths: string[];
  /** Set when a dependency was removed (vs. file removal) */
  removalType?: 'files' | 'dependency';
  /** Dependency name when removalType is 'dependency' */
  removedDependency?: string;
  /** Which manifest section the dependency was removed from */
  removedFromSection?: 'dependencies' | 'dev-dependencies';
}

export async function runRemoveFromSourcePipeline(
  packageName: string | undefined,
  pathArg: string | undefined,
  options: RemoveFromSourceOptions = {}
): Promise<CommandResult<RemoveFromSourceResult>> {
  const cwd = process.cwd();

  // Resolve arguments: packageName from --from option, pathArg is required
  let resolvedPackageName: string | null;
  let resolvedPath: string;
  try {
    const resolved = await resolveSourceOperationArguments(
      cwd,
      packageName,
      pathArg,
      { command: 'remove', checkWorkspaceRoot: true }
    );
    resolvedPackageName = resolved.resolvedPackageName;
    resolvedPath = resolved.resolvedPath;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  // Build removal context (workspace root or mutable package source)
  let packageRootDir: string;
  let resolvedName: string;
  let sourceType: 'workspace' | 'global';
  
  if (resolvedPackageName === null) {
    // No package name: remove from workspace root (.openpackage/)
    try {
      const context = await buildWorkspacePackageContext(cwd);
      packageRootDir = context.packageRootDir;
      resolvedName = context.name;
      sourceType = 'workspace';
      
      logger.info('Removing files from workspace package', {
        sourcePath: packageRootDir,
        inputPath: resolvedPath
      });
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  } else {
    // Package name provided: resolve mutable source
    let source;
    try {
      source = await resolveMutableSource({ cwd, packageName: resolvedPackageName });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    
    // Additional safety check
    assertMutableSourceOrThrow(source.absolutePath, { packageName: source.packageName, command: 'remove' });

    packageRootDir = source.absolutePath;
    resolvedName = source.packageName;
    sourceType = source.absolutePath.includes(`${cwd}/.openpackage/packages/`) 
      ? 'workspace' as const
      : 'global' as const;
    
    logger.info('Removing files from package source', {
      packageName: source.packageName,
      sourcePath: source.absolutePath,
      sourceType: source.sourceType,
      inputPath: resolvedPath
    });
  }

  // Classify input: file/directory path vs. dependency (./ = file, bare name = dep-first)
  const manifestPath = join(packageRootDir, FILE_PATTERNS.OPENPACKAGE_YML);
  const classification = await classifyRemoveInput(resolvedPath, packageRootDir, manifestPath);

  if (classification?.mode === 'dependency') {
    // Dependency removal: update manifest
    const depResult = await runRemoveDependencyFlow(
      manifestPath,
      classification.dependencyName!,
      resolvedName
    );
    if (!depResult.removed) {
      return {
        success: false,
        error: `Dependency '${resolvedPath}' not found in package.`
      };
    }
    return {
      success: true,
      data: {
        packageName: resolvedName,
        filesRemoved: 0,
        sourcePath: packageRootDir,
        sourceType,
        removedPaths: [],
        removalType: 'dependency',
        removedDependency: classification.dependencyName,
        removedFromSection: depResult.section
      }
    };
  }

  // File removal: collect and remove files
  let entries: RemovalEntry[];
  try {
    entries = await collectRemovalEntries(packageRootDir, resolvedPath);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (entries.length === 0) {
    return {
      success: false,
      error: `No files found to remove at path: ${resolvedPath}`
    };
  }

  options.beforeConfirm?.({
    packageName: resolvedName,
    sourcePath: packageRootDir
  });

  // Confirm removal with user (unless --force or --dry-run).
  // Use withRichOutput so the confirmation prompt uses the interactive
  // (clack) output adapter when available on TTY.
  const execCtx = options.execContext;
  const doConfirm = () => confirmRemoval(resolvedName, entries, options);
  try {
    if (execCtx) {
      await withRichOutput(execCtx, doConfirm);
    } else {
      await doConfirm();
    }
  } catch (error) {
    if (error instanceof UserCancellationError) {
      throw error;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Removal cancelled by user.'
    };
  }

  // Handle dry-run
  if (options.dryRun) {
    logger.info('Dry-run mode: no files will be removed', {
      packageName: resolvedName,
      filesCount: entries.length
    });

    return {
      success: true,
      data: {
        packageName: resolvedName,
        filesRemoved: entries.length,
        sourcePath: packageRootDir,
        sourceType,
        removedPaths: entries.map(e => e.registryPath),
        removalType: 'files'
      }
    };
  }

  // Remove files
  const removedPaths: string[] = [];
  const removedAbsolutePaths: string[] = [];

  for (const entry of entries) {
    if (await exists(entry.packagePath)) {
      await remove(entry.packagePath);
      removedPaths.push(entry.registryPath);
      removedAbsolutePaths.push(entry.packagePath);
      logger.debug('Removed file', { path: entry.packagePath });
    }
  }

  // Clean up empty directories
  await cleanupEmptyParents(packageRootDir, removedAbsolutePaths);

  logger.info('Files removed from package source', {
    packageName: resolvedName,
    filesRemoved: removedPaths.length
  });

  return {
    success: true,
    data: {
      packageName: resolvedName,
      filesRemoved: removedPaths.length,
      sourcePath: packageRootDir,
      sourceType,
      removedPaths,
      removalType: 'files'
    }
  };
}

/**
 * Run removal for multiple paths as a single batch (one confirmation, one removal).
 * Used when interactive selection yields multiple files.
 */
export async function runRemoveFromSourcePipelineBatch(
  packageName: string | null,
  packageRootDir: string,
  resolvedName: string,
  pathArgs: string[],
  options: RemoveFromSourceOptions = {}
): Promise<CommandResult<RemoveFromSourceResult>> {
  const sourceType: 'workspace' | 'global' =
    packageRootDir.includes(`${process.cwd()}/.openpackage/packages/`) ? 'workspace' : 'global';

  const allEntries: RemovalEntry[] = [];
  const seenRegistryPaths = new Set<string>();

  for (const pathArg of pathArgs) {
    try {
      const entries = await collectRemovalEntries(packageRootDir, pathArg);
      for (const entry of entries) {
        if (!seenRegistryPaths.has(entry.registryPath)) {
          seenRegistryPaths.add(entry.registryPath);
          allEntries.push(entry);
        }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (allEntries.length === 0) {
    return { success: false, error: 'No files found to remove.' };
  }

  try {
    await confirmRemoval(resolvedName, allEntries, options);
  } catch (error) {
    if (error instanceof UserCancellationError) {
      throw error;
    }
    return { success: false, error: error instanceof Error ? error.message : 'Removal cancelled by user.' };
  }

  if (options.dryRun) {
    return {
      success: true,
      data: {
        packageName: resolvedName,
        filesRemoved: allEntries.length,
        sourcePath: packageRootDir,
        sourceType,
        removedPaths: allEntries.map(e => e.registryPath),
        removalType: 'files'
      }
    };
  }

  const removedPaths: string[] = [];
  const removedAbsolutePaths: string[] = [];

  for (const entry of allEntries) {
    if (await exists(entry.packagePath)) {
      await remove(entry.packagePath);
      removedPaths.push(entry.registryPath);
      removedAbsolutePaths.push(entry.packagePath);
    }
  }

  await cleanupEmptyParents(packageRootDir, removedAbsolutePaths);

  return {
    success: true,
    data: {
      packageName: resolvedName,
      filesRemoved: removedPaths.length,
      sourcePath: packageRootDir,
      sourceType,
      removedPaths,
      removalType: 'files'
    }
  };
}
