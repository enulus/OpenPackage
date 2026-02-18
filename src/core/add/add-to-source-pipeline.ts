import { resolve as resolvePath, join } from 'path';

import type { CommandResult } from '../../types/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import { assertMutableSourceOrThrow } from '../../utils/source-mutability.js';
import { collectSourceEntries, type SourceEntry } from './source-collector.js';
import { copyFilesWithConflictResolution } from './add-conflict-handler.js';
import type { PackageContext } from '../package-context.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { resolveSourceOperationArguments } from '../../utils/source-operation-arguments.js';
import { buildWorkspacePackageContext } from '../../utils/workspace-package-context.js';

export interface AddToSourceOptions {
  platformSpecific?: boolean;
  force?: boolean;
  execContext?: ExecutionContext;
}

export interface AddToSourceResult {
  packageName: string;
  filesAdded: number;
  sourcePath: string;
  sourceType: 'workspace' | 'global';
  isWorkspaceRoot: boolean;
  addedFilePaths: string[];
}

export async function runAddToSourcePipeline(
  packageName: string | undefined,
  pathArg: string | undefined,
  options: AddToSourceOptions = {}
): Promise<CommandResult<AddToSourceResult>> {
  const cwd = process.cwd();

  // Resolve arguments: packageName from --to option, pathArg is required
  const { resolvedPackageName, resolvedPath } = await resolveSourceOperationArguments(
    cwd,
    packageName,
    pathArg,
    { command: 'add', checkWorkspaceRoot: false }
  );

  const absInputPath = resolvePath(cwd, resolvedPath);
  if (!(await exists(absInputPath))) {
    return { success: false, error: `Path not found: ${resolvedPath}` };
  }

  // Build package context (workspace root or mutable package source)
  let packageContext: Pick<PackageContext, 'name' | 'version' | 'config' | 'packageYmlPath' | 'packageRootDir' | 'packageFilesDir'>;
  let sourceType: 'workspace' | 'global';
  const isWorkspaceRoot = resolvedPackageName === null;
  
  if (isWorkspaceRoot) {
    // No package name: add to workspace root (.openpackage/)
    try {
      packageContext = await buildWorkspacePackageContext(cwd);
      sourceType = 'workspace';
      
      logger.info('Adding files to workspace package', {
        sourcePath: packageContext.packageRootDir,
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
    assertMutableSourceOrThrow(source.absolutePath, { packageName: source.packageName, command: 'add' });

    packageContext = await buildPackageContextFromSource(source);
    sourceType = source.absolutePath.includes(`${cwd}/.openpackage/packages/`) 
      ? 'workspace' as const
      : 'global' as const;
    
    logger.info('Adding files to package source', {
      packageName: source.packageName,
      sourcePath: source.absolutePath,
      sourceType: source.sourceType,
      inputPath: resolvedPath
    });
  }

  // Collect entries - source-collector now handles flow-based mapping
  const entries = await collectSourceEntries(absInputPath, cwd);

  const changed = await copyFilesWithConflictResolution(packageContext, entries, options);

  logger.info('Files copied to package source', {
    packageName: packageContext.name,
    filesAdded: changed.length
  });

  // Build array of added file paths (package-root-relative paths)
  const addedFilePaths = changed.map(file => join(packageContext.packageRootDir, file.path));

  return {
    success: true,
    data: {
      packageName: packageContext.name,
      filesAdded: changed.length,
      sourcePath: packageContext.packageRootDir,
      sourceType,
      isWorkspaceRoot,
      addedFilePaths
    }
  };
}

/**
 * Run add pipeline for multiple paths as a single batch (one copy pass, one result).
 * Used when interactive selection yields multiple files.
 */
export async function runAddToSourcePipelineBatch(
  packageName: string | undefined,
  absPaths: string[],
  cwd: string,
  options: AddToSourceOptions = {}
): Promise<CommandResult<AddToSourceResult>> {
  let packageContext: Pick<PackageContext, 'name' | 'version' | 'config' | 'packageYmlPath' | 'packageRootDir' | 'packageFilesDir'>;
  let sourceType: 'workspace' | 'global';
  const isWorkspaceRoot = !packageName;

  if (isWorkspaceRoot) {
    try {
      packageContext = await buildWorkspacePackageContext(cwd);
      sourceType = 'workspace';
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  } else {
    let source;
    try {
      source = await resolveMutableSource({ cwd, packageName });
      assertMutableSourceOrThrow(source.absolutePath, { packageName: source.packageName, command: 'add' });
      packageContext = await buildPackageContextFromSource(source);
      sourceType = source.absolutePath.includes(`${cwd}/.openpackage/packages/`) ? 'workspace' : 'global';
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const allEntries: SourceEntry[] = [];
  const seenRegistryPaths = new Set<string>();

  for (const absPath of absPaths) {
    if (!(await exists(absPath))) {
      return { success: false, error: `Path not found: ${absPath}` };
    }
    try {
      const entries = await collectSourceEntries(absPath, cwd);
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
    return { success: true, data: { packageName: packageContext.name, filesAdded: 0, sourcePath: packageContext.packageRootDir, sourceType, isWorkspaceRoot, addedFilePaths: [] } };
  }

  const changed = await copyFilesWithConflictResolution(packageContext, allEntries, options);
  const addedFilePaths = changed.map(f => join(packageContext.packageRootDir, f.path));

  return {
    success: true,
    data: {
      packageName: packageContext.name,
      filesAdded: changed.length,
      sourcePath: packageContext.packageRootDir,
      sourceType,
      isWorkspaceRoot,
      addedFilePaths
    }
  };
}

/**
 * Build context for workspace root package at .openpackage/
 * Creates the workspace manifest if it doesn't exist.
 */
type AddContext = Pick<PackageContext, 'name' | 'version' | 'config' | 'packageYmlPath' | 'packageRootDir' | 'packageFilesDir'>;

/**
 * Build add context from a resolved mutable source.
 */
async function buildPackageContextFromSource(
  source: Awaited<ReturnType<typeof resolveMutableSource>>
): Promise<AddContext> {
  const packageYmlPath = join(source.absolutePath, FILE_PATTERNS.OPENPACKAGE_YML);
  const config = await parsePackageYml(packageYmlPath);

  return {
    name: source.packageName,
    version: config.version,
    config,
    packageYmlPath,
    packageRootDir: source.absolutePath,
    packageFilesDir: source.absolutePath
  };
}




