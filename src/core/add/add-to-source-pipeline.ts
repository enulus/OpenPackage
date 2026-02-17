import { resolve as resolvePath, join } from 'path';

import type { CommandResult } from '../../types/index.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import { assertMutableSourceOrThrow } from '../../utils/source-mutability.js';
import { collectSourceEntries } from './source-collector.js';
import { copyFilesWithConflictResolution } from './add-conflict-handler.js';
import type { PackageContext } from '../package-context.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { resolveSourceOperationArguments } from '../../utils/source-operation-arguments.js';
import { buildWorkspacePackageContext } from '../../utils/workspace-package-context.js';

export interface AddToSourceOptions {
  platformSpecific?: boolean;
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

  const changed = await copyFilesWithConflictResolution(packageContext, entries);

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




