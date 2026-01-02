import { resolve as resolvePath, dirname, join } from 'path';
import { readdir } from 'fs/promises';

import type { CommandResult } from '../../types/index.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { assertMutableSourceOrThrow } from '../../utils/source-mutability.js';
import { collectRemovalEntries, type RemovalEntry } from './removal-collector.js';
import { confirmRemoval } from './removal-confirmation.js';
import { exists, remove } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

export interface RemoveFromSourceOptions {
  apply?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export interface RemoveFromSourceResult {
  packageName: string;
  filesRemoved: number;
  sourcePath: string;
  sourceType: 'workspace' | 'global';
  removedPaths: string[];
}

export async function runRemoveFromSourcePipeline(
  packageName: string | undefined,
  pathArg: string | undefined,
  options: RemoveFromSourceOptions = {}
): Promise<CommandResult<RemoveFromSourceResult>> {
  const cwd = process.cwd();

  // Validate inputs
  if (!packageName) {
    return { success: false, error: 'Package name is required for remove.' };
  }
  if (!pathArg) {
    return { success: false, error: 'Path argument is required for remove.' };
  }

  // Resolve mutable package source (workspace or global, but not registry)
  let source;
  try {
    source = await resolveMutableSource({ cwd, packageName });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  
  // Additional safety check
  assertMutableSourceOrThrow(source.absolutePath, { packageName: source.packageName, command: 'remove' });

  logger.info('Removing files from package source', {
    packageName: source.packageName,
    sourcePath: source.absolutePath,
    sourceType: source.sourceType,
    inputPath: pathArg
  });

  // Collect files to remove
  let entries: RemovalEntry[];
  try {
    entries = await collectRemovalEntries(source.absolutePath, pathArg);
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }

  if (entries.length === 0) {
    return {
      success: false,
      error: `No files found to remove at path: ${pathArg}`
    };
  }

  // Confirm removal with user (unless --force or --dry-run)
  try {
    await confirmRemoval(source.packageName, entries, options);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Removal cancelled by user.'
    };
  }

  // Determine source type for result
  const sourceType = source.absolutePath.includes(`${cwd}/.openpackage/packages/`) 
    ? 'workspace' as const
    : 'global' as const;

  // Handle dry-run
  if (options.dryRun) {
    logger.info('Dry-run mode: no files will be removed', {
      packageName: source.packageName,
      filesCount: entries.length
    });

    return {
      success: true,
      data: {
        packageName: source.packageName,
        filesRemoved: entries.length,
        sourcePath: source.absolutePath,
        sourceType,
        removedPaths: entries.map(e => e.registryPath)
      }
    };
  }

  // Remove files
  const removedPaths: string[] = [];
  const directoriesToClean = new Set<string>();

  for (const entry of entries) {
    if (await exists(entry.packagePath)) {
      await remove(entry.packagePath);
      removedPaths.push(entry.registryPath);
      
      // Track parent directories for cleanup
      let parent = dirname(entry.packagePath);
      while (parent !== source.absolutePath && parent.startsWith(source.absolutePath)) {
        directoriesToClean.add(parent);
        parent = dirname(parent);
      }
      
      logger.debug('Removed file', { path: entry.packagePath });
    }
  }

  // Clean up empty directories
  await cleanupEmptyDirectories(Array.from(directoriesToClean).sort((a, b) => b.length - a.length));

  logger.info('Files removed from package source', {
    packageName: source.packageName,
    filesRemoved: removedPaths.length
  });

  // Handle --apply flag: requires package to be installed in current workspace
  if (options.apply) {
    logger.info('Applying changes to workspace (--apply flag)', { packageName: source.packageName });
    
    try {
      // Check if package is installed in current workspace
      await resolvePackageSource(cwd, packageName);
      
      // Apply changes to workspace
      const { runApplyPipeline } = await import('../apply/apply-pipeline.js');
      const applyResult = await runApplyPipeline(source.packageName, {});
      
      if (!applyResult.success) {
        return {
          success: false,
          error: `Files removed from package source, but apply failed:\n${applyResult.error}`
        };
      }
      
      logger.info('Changes applied to workspace', { packageName: source.packageName });
    } catch (error) {
      return {
        success: false,
        error: 
          `Files removed from package source at: ${source.absolutePath}\n\n` +
          `However, --apply failed because package '${packageName}' is not installed in this workspace.\n\n` +
          `To sync deletions to your workspace:\n` +
          `  1. Ensure package is installed: opkg install ${packageName}\n` +
          `  2. Apply the changes: opkg apply ${packageName}\n\n` +
          `Or run 'opkg remove' without --apply flag to skip workspace sync.`
      };
    }
  }

  return {
    success: true,
    data: {
      packageName: source.packageName,
      filesRemoved: removedPaths.length,
      sourcePath: source.absolutePath,
      sourceType,
      removedPaths
    }
  };
}

/**
 * Clean up empty directories after file removal.
 * Directories are processed from deepest to shallowest.
 */
async function cleanupEmptyDirectories(directories: string[]): Promise<void> {
  for (const dir of directories) {
    try {
      if (await exists(dir)) {
        const entries = await readdir(dir);
        if (entries.length === 0) {
          await remove(dir);
          logger.debug('Removed empty directory', { path: dir });
        }
      }
    } catch (error) {
      // Ignore errors during cleanup
      logger.debug('Failed to clean up directory', { 
        path: dir, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
}
