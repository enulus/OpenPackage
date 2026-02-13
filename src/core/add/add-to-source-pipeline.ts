import { resolve as resolvePath, join, basename } from 'path';

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
import { ensureLocalOpenPackageStructure, createWorkspacePackageYml } from '../../utils/package-management.js';
import { getLocalOpenPackageDir } from '../../utils/paths.js';

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
  const { resolvedPackageName, resolvedPath } = await resolveAddArguments(cwd, packageName, pathArg);

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
    const result = await buildWorkspaceRootContext(cwd);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    packageContext = result.context!;
    sourceType = 'workspace';
    
    logger.info('Adding files to workspace package', {
      sourcePath: packageContext.packageRootDir,
      inputPath: resolvedPath
    });
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
 * Resolve add command arguments to determine package name and input path.
 * packageName comes from --to option (undefined if not provided → workspace root).
 * pathArg is the required <path> argument.
 */
async function resolveAddArguments(
  cwd: string,
  packageName: string | undefined,
  pathArg: string | undefined
): Promise<{ resolvedPackageName: string | null; resolvedPath: string }> {
  // Two arguments provided: explicit package name + path
  if (packageName && pathArg) {
    return { resolvedPackageName: packageName, resolvedPath: pathArg };
  }

  // One argument provided
  const singleArg = packageName || pathArg;
  if (!singleArg) {
    throw new Error('Path argument is required for add.');
  }

  // Check if single arg is a valid filesystem path
  const absPath = resolvePath(cwd, singleArg);
  if (await exists(absPath)) {
    // It's a path → add to workspace root
    return { resolvedPackageName: null, resolvedPath: singleArg };
  }

  // Not a filesystem path → treat as package name (error will be thrown later)
  throw new Error(
    `Path '${singleArg}' not found.\n\n` +
    `If you meant to specify a package name, use: opkg add <path> --to ${singleArg}`
  );
}

/**
 * Build context for workspace root package at .openpackage/
 * Creates the workspace manifest if it doesn't exist.
 */
type AddContext = Pick<PackageContext, 'name' | 'version' | 'config' | 'packageYmlPath' | 'packageRootDir' | 'packageFilesDir'>;

async function buildWorkspaceRootContext(
  cwd: string
): Promise<{ success: true; context: AddContext } | { success: false; error: string }> {
  // Ensure .openpackage/ structure exists
  await ensureLocalOpenPackageStructure(cwd);

  // Create workspace manifest if it doesn't exist
  await createWorkspacePackageYml(cwd);

  const openpackageDir = getLocalOpenPackageDir(cwd);
  const packageYmlPath = join(openpackageDir, FILE_PATTERNS.OPENPACKAGE_YML);

  // Load workspace manifest
  let config;
  try {
    config = await parsePackageYml(packageYmlPath);
  } catch (error) {
    return {
      success: false,
      error: `Failed to read workspace manifest at ${packageYmlPath}: ${error}`
    };
  }

  // Use workspace directory name as package name if not specified in manifest
  const packageName = config.name || basename(cwd);

  return {
    success: true,
    context: {
      name: packageName,
      version: config.version,
      config,
      packageYmlPath,
      packageRootDir: openpackageDir,
      packageFilesDir: openpackageDir
    }
  };
}

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




