import { resolve as resolvePath, join, basename } from 'path';

import type { CommandResult } from '../../types/index.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { assertMutableSourceOrThrow } from '../../utils/source-mutability.js';
import { collectSourceEntries } from './source-collector.js';
import { copyFilesWithConflictResolution } from './add-conflict-handler.js';
import type { AddPackageContext } from './add-context.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { buildApplyContext } from '../install/unified/context-builders.js';
import { runUnifiedInstallPipeline } from '../install/unified/pipeline.js';
import { ensureLocalOpenPackageStructure, createWorkspacePackageYml } from '../../utils/package-management.js';
import { getLocalOpenPackageDir } from '../../utils/paths.js';

export interface AddToSourceOptions {
  apply?: boolean;
  platformSpecific?: boolean;
}

export interface AddToSourceResult {
  packageName: string;
  filesAdded: number;
  sourcePath: string;
  sourceType: 'workspace' | 'global';
  addedFilePaths: string[];
}

export async function runAddToSourcePipeline(
  packageName: string | undefined,
  pathArg: string | undefined,
  options: AddToSourceOptions = {}
): Promise<CommandResult<AddToSourceResult>> {
  const cwd = process.cwd();

  // Resolve arguments: support both two-arg and one-arg (path-only) modes
  const { resolvedPackageName, resolvedPath } = await resolveAddArguments(cwd, packageName, pathArg);

  const absInputPath = resolvePath(cwd, resolvedPath);
  if (!(await exists(absInputPath))) {
    return { success: false, error: `Path not found: ${resolvedPath}` };
  }

  // Build package context (workspace root or mutable package source)
  let packageContext: AddPackageContext;
  let sourceType: 'workspace' | 'global';
  
  if (resolvedPackageName === null) {
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

  // Handle --apply flag: requires package to be installed in current workspace
  if (options.apply) {
    logger.info('Applying changes to workspace (--apply flag)', { packageName: packageContext.name });
    
    try {
      // Check if package is installed in current workspace
      await resolvePackageSource(cwd, packageContext.name);

      // Build apply context and run unified pipeline
      const applyCtx = await buildApplyContext(cwd, packageContext.name, {});
      const applyResult = await runUnifiedInstallPipeline(applyCtx);
      
      if (!applyResult.success) {
        return {
          success: false,
          error: `Files added to package source, but apply failed:\n${applyResult.error}`
        };
      }
      
      logger.info('Changes applied to workspace', { packageName: packageContext.name });
    } catch (error) {
      return {
        success: false,
        error: 
          `Files added to package source at: ${packageContext.packageRootDir}\n\n` +
          `However, --apply failed because package '${packageContext.name}' is not installed in this workspace.\n\n` +
          `To sync changes to your workspace:\n` +
          `  1. Install the package: opkg install ${packageContext.name}\n` +
          `  2. Apply the changes: opkg apply ${packageContext.name}\n\n` +
          `Or run 'opkg add' without --apply flag to skip workspace sync.`
      };
    }
  }

  // Build array of added file paths (package-root-relative paths)
  const addedFilePaths = changed.map(file => join(packageContext.packageRootDir, file.path));

  return {
    success: true,
    data: {
      packageName: packageContext.name,
      filesAdded: changed.length,
      sourcePath: packageContext.packageRootDir,
      sourceType,
      addedFilePaths
    }
  };
}

/**
 * Resolve add command arguments to determine package name and input path.
 * Supports both two-arg mode (package + path) and one-arg mode (path only → workspace root).
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
    `If you meant to specify a package name, use: opkg add ${singleArg} <path>`
  );
}

/**
 * Build context for workspace root package at .openpackage/
 * Creates the workspace manifest if it doesn't exist.
 */
async function buildWorkspaceRootContext(
  cwd: string
): Promise<{ success: true; context: AddPackageContext } | { success: false; error: string }> {
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
): Promise<AddPackageContext> {
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




