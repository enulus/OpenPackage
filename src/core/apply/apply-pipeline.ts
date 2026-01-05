import { dirname, join, sep } from 'path';

import type { CommandResult, PackageFile, InstallOptions } from '../../types/index.js';
import { DEPENDENCY_ARRAYS, UNVERSIONED } from '../../constants/index.js';
import { applyPlannedSyncForPackageFiles } from '../../utils/index-based-installer.js';
import { readPackageFilesForRegistry } from '../../utils/package-copy.js';
import { PACKAGE_PATHS } from '../../constants/index.js';
import { printPlatformSyncSummary } from '../sync/platform-sync-summary.js';
import { getDetectedPlatforms, platformUsesFlows } from '../platforms.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { stripRootCopyPrefix, isRootCopyPath } from '../../utils/platform-root-files.js';
import { ensureDir, writeTextFile } from '../../utils/fs.js';
import { syncRootFiles } from '../sync/root-files-sync.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { PlatformSyncResult } from '../sync/platform-sync.js';
import { resolveDeclaredPath, toTildePath } from '../../utils/path-resolution.js';
import { isRegistryPath } from '../../utils/source-mutability.js';
import { MUTABILITY, SOURCE_TYPES } from '../../constants/index.js';
import { installPackageWithFlows } from '../install/flow-based-installer.js';
import { logger } from '../../utils/logger.js';

export interface ApplyPipelineOptions extends InstallOptions {}

export interface ApplyPipelineResult {
  config: { name: string; version: string };
  packageFiles: PackageFile[];
  syncResult: PlatformSyncResult;
}

export async function runApplyPipeline(
  packageName: string | undefined,
  options: ApplyPipelineOptions = {}
): Promise<CommandResult<ApplyPipelineResult>> {
  const cwd = process.cwd();
  const { index } = await readWorkspaceIndex(cwd);
  const targets =
    packageName !== undefined ? [packageName] : Object.keys(index.packages ?? {}).sort();

  if (targets.length === 0) {
    return {
      success: false,
      error:
        `No packages installed in this workspace.\n` +
        `Run 'opkg install <package-name>' to install a package first.`
    };
  }

  const results: ApplyPipelineResult[] = [];
  for (const target of targets) {
    const outcome = await applySinglePackage(cwd, target, options);
    if (!outcome.success) {
      return outcome;
    }
    results.push(outcome.data!);
  }

  // Return last applied package summary for compatibility
  return {
    success: true,
    data: results[results.length - 1]
  };
}

async function applySinglePackage(
  cwd: string,
  packageName: string,
  options: ApplyPipelineOptions
): Promise<CommandResult<ApplyPipelineResult>> {
  const { index } = await readWorkspaceIndex(cwd);
  const entry = index.packages?.[packageName];
  if (!entry?.path) {
    return {
      success: false,
      error:
        `Package '${packageName}' is not installed in this workspace.\n` +
        `Run 'opkg install ${packageName}' to install it first.`
    };
  }

  const resolved = resolveDeclaredPath(entry.path, cwd);
  const absolutePath = join(resolved.absolute, sep);
  const mutability = isRegistryPath(absolutePath) ? MUTABILITY.IMMUTABLE : MUTABILITY.MUTABLE;
  const sourceType = isRegistryPath(absolutePath) ? SOURCE_TYPES.REGISTRY : SOURCE_TYPES.PATH;

  const source = {
    packageName,
    absolutePath,
    declaredPath: resolved.declared,
    mutability,
    version: entry.version,
    sourceType
  };
  const packageFiles = (await readPackageFilesForRegistry(source.absolutePath)).filter(
    file => file.path !== PACKAGE_PATHS.INDEX_RELATIVE
  );

  const version = source.version ?? UNVERSIONED;
  const conflictStrategy = options.force ? 'overwrite' : options.conflictStrategy ?? 'ask';
  const platforms = await getDetectedPlatforms(cwd);
  // NOTE: Apply must produce a correct file mapping in the workspace index.
  // The flow-based installer integration does not yet build index mappings, so apply
  // always uses the index-based installer path (which is mapping-aware).
  logger.debug(`Applying ${packageName} using index-based installer`);
  const syncOutcome = await applyPlannedSyncForPackageFiles(
    cwd,
    source.packageName,
    version,
    packageFiles,
    platforms,
    { ...options, conflictStrategy },
    'nested'
  );

  // Handle root files and root/** copy-to-root content.
  const rootSyncResult = await syncRootFiles(cwd, packageFiles, source.packageName, platforms);
  await syncRootCopyContent(cwd, packageFiles, options);

  // Persist unified workspace index entry.
  await upsertWorkspaceIndexEntry(cwd, {
    name: source.packageName,
    path: source.declaredPath,
    version: source.version,
    files: syncOutcome.mapping
  });

  printPlatformSyncSummary({
    actionLabel: 'Applied',
    packageContext: {
      config: { name: source.packageName, version: source.version },
      location: 'nested',
      packageDir: source.absolutePath,
      packageYmlPath: '',
      isCwdPackage: false
    } as any, // legacy summary shape; minimal fields for printing
    version,
    packageFiles,
    syncResult: {
      created: syncOutcome.operation.installedFiles.concat(rootSyncResult.created),
      updated: syncOutcome.operation.updatedFiles.concat(rootSyncResult.updated),
      deleted: syncOutcome.operation.deletedFiles
    }
  });

  return {
    success: true,
    data: {
      config: { name: source.packageName, version },
      packageFiles,
      syncResult: {
        created: syncOutcome.operation.installedFiles.concat(rootSyncResult.created),
        updated: syncOutcome.operation.updatedFiles.concat(rootSyncResult.updated),
        deleted: syncOutcome.operation.deletedFiles
      }
    }
  };
}

async function syncRootCopyContent(
  cwd: string,
  packageFiles: PackageFile[],
  options: InstallOptions
): Promise<void> {
  const rootCopyFiles = packageFiles.filter(file => isRootCopyPath(file.path));
  for (const file of rootCopyFiles) {
    const stripped = stripRootCopyPrefix(normalizePathForProcessing(file.path) || '');
    if (!stripped) continue;
    const absTarget = join(cwd, stripped);
    if (options.dryRun) continue;
    await ensureDir(dirname(absTarget));
    await writeTextFile(absTarget, file.content, (file.encoding as BufferEncoding) ?? 'utf8');
  }
}

interface WorkspaceIndexUpdate {
  name: string;
  path: string;
  version?: string;
  files: Record<string, string[]>;
}

async function upsertWorkspaceIndexEntry(
  cwd: string,
  update: WorkspaceIndexUpdate
): Promise<void> {
  const record = await readWorkspaceIndex(cwd);
  // Convert absolute paths under ~/.openpackage/ to tilde notation
  const pathToWrite = toTildePath(update.path);
  record.index.packages[update.name] = {
    path: pathToWrite,
    version: update.version,
    files: update.files
  };
  await writeWorkspaceIndex(record);
}
