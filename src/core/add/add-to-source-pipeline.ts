import { resolve as resolvePath, join } from 'path';

import type { CommandResult } from '../../types/index.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { assertMutableSourceOrThrow } from '../../utils/source-mutability.js';
import { collectSourceEntries, type SourceEntry } from './source-collector.js';
import { copyFilesWithConflictResolution } from './add-conflict-handler.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { getPlatformRootFileNames } from '../../utils/platform-root-files.js';
import { getAllUniversalSubdirs, getAllPlatforms } from '../platforms.js';
import type { PackageContext } from '../package-context.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

export interface AddToSourceOptions {
  apply?: boolean;
  platformSpecific?: boolean;
}

export interface AddToSourceResult {
  packageName: string;
  filesAdded: number;
  sourcePath: string;
  sourceType: 'workspace' | 'global';
}

export async function runAddToSourcePipeline(
  packageName: string | undefined,
  pathArg: string | undefined,
  options: AddToSourceOptions = {}
): Promise<CommandResult<AddToSourceResult>> {
  const cwd = process.cwd();

  if (!packageName) {
    return { success: false, error: 'Package name is required for add.' };
  }
  if (!pathArg) {
    return { success: false, error: 'Path argument is required for add.' };
  }

  const absInputPath = resolvePath(cwd, pathArg);
  if (!(await exists(absInputPath))) {
    return { success: false, error: `Path not found: ${pathArg}` };
  }

  // Resolve mutable package source (workspace or global, but not registry)
  let source;
  try {
    source = await resolveMutableSource({ cwd, packageName });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  
  // Additional safety check (should never fail given resolveMutableSource guarantees)
  assertMutableSourceOrThrow(source.absolutePath, { packageName: source.packageName, command: 'add' });

  logger.info('Adding files to package source', {
    packageName: source.packageName,
    sourcePath: source.absolutePath,
    sourceType: source.sourceType,
    inputPath: pathArg
  });

  const rawEntries = await collectSourceEntries(absInputPath, cwd);
  const entries = applyCopyToRootRule(rawEntries, cwd);

  const packageContext = await buildPackageContext(source);
  const changed = await copyFilesWithConflictResolution(packageContext, entries);

  logger.info('Files copied to package source', {
    packageName: source.packageName,
    filesAdded: changed.length
  });

  // Determine source type for result
  const sourceType = source.absolutePath.includes(`${cwd}/.openpackage/packages/`) 
    ? 'workspace' as const
    : 'global' as const;

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
          error: `Files added to package source, but apply failed:\n${applyResult.error}`
        };
      }
      
      logger.info('Changes applied to workspace', { packageName: source.packageName });
    } catch (error) {
      return {
        success: false,
        error: 
          `Files added to package source at: ${source.absolutePath}\n\n` +
          `However, --apply failed because package '${packageName}' is not installed in this workspace.\n\n` +
          `To sync changes to your workspace:\n` +
          `  1. Install the package: opkg install ${packageName}\n` +
          `  2. Apply the changes: opkg apply ${packageName}\n\n` +
          `Or run 'opkg add' without --apply flag to skip workspace sync.`
      };
    }
  }

  return {
    success: true,
    data: {
      packageName: source.packageName,
      filesAdded: changed.length,
      sourcePath: source.absolutePath,
      sourceType
    }
  };
}

function applyCopyToRootRule(entries: SourceEntry[], cwd: string): SourceEntry[] {
  const universalSubdirs = getAllUniversalSubdirs(cwd);
  const rootFileNames = getPlatformRootFileNames(getAllPlatforms(undefined, cwd), cwd);

  return entries.map(entry => {
    const normalized = normalizePathForProcessing(entry.registryPath) || entry.registryPath;

    const isUniversal =
      universalSubdirs.has(normalized.split('/')[0] || '') ||
      normalized.startsWith(`${FILE_PATTERNS.AGENTS_MD}`) ||
      normalized.startsWith('root/');

    const isRootFile = rootFileNames.has(normalized);

    if (isUniversal || isRootFile) {
      return { ...entry, registryPath: normalized };
    }

    // Everything else → copy-to-root
    return { ...entry, registryPath: normalizePathForProcessing(`root/${normalized}`) || `root/${normalized}` };
  });
}

async function buildPackageContext(source: Awaited<ReturnType<typeof resolveMutableSource>>): Promise<PackageContext> {
  const packageYmlPath = join(source.absolutePath, FILE_PATTERNS.OPENPACKAGE_YML);
  const config = await parsePackageYml(packageYmlPath);

  return {
    name: source.packageName,
    version: config.version,
    config,
    packageYmlPath,
    packageRootDir: source.absolutePath,
    packageFilesDir: source.absolutePath,
    location: 'nested',
    isCwdPackage: false
  };
}
