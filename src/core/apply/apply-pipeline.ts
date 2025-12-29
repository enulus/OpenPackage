import { dirname, join } from 'path';

import type { CommandResult, PackageFile, InstallOptions } from '../../types/index.js';
import { DEPENDENCY_ARRAYS, UNVERSIONED } from '../../constants/index.js';
import { applyPlannedSyncForPackageFiles } from '../../utils/index-based-installer.js';
import { readPackageFilesForRegistry } from '../../utils/package-copy.js';
import { PACKAGE_PATHS } from '../../constants/index.js';
import { printPlatformSyncSummary } from '../sync/platform-sync-summary.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { getLocalPackageYmlPath } from '../../utils/paths.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { getDetectedPlatforms } from '../platforms.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { stripRootCopyPrefix, isRootCopyPath } from '../../utils/platform-root-files.js';
import { ensureDir, writeTextFile } from '../../utils/fs.js';
import { syncRootFiles } from '../sync/root-files-sync.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { PlatformSyncResult } from '../sync/platform-sync.js';

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
  const targets =
    packageName !== undefined
      ? [packageName]
      : await collectDeclaredPackageNames(cwd);

  if (targets.length === 0) {
    return { success: false, error: 'No packages declared in .openpackage/openpackage.yml' };
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

async function collectDeclaredPackageNames(cwd: string): Promise<string[]> {
  const manifestPath = getLocalPackageYmlPath(cwd);
  const manifest = await parsePackageYml(manifestPath);
  const names = new Set<string>();
  const append = (arr: any[] | undefined) => {
    if (!arr) return;
    for (const dep of arr) {
      if (dep?.name) names.add(dep.name);
    }
  };
  append(manifest[DEPENDENCY_ARRAYS.PACKAGES]);
  append(manifest[DEPENDENCY_ARRAYS.DEV_PACKAGES]);
  return Array.from(names);
}

async function applySinglePackage(
  cwd: string,
  packageName: string,
  options: ApplyPipelineOptions
): Promise<CommandResult<ApplyPipelineResult>> {
  const source = await resolvePackageSource(cwd, packageName);
  const packageFiles = (await readPackageFilesForRegistry(source.absolutePath)).filter(
    file => file.path !== PACKAGE_PATHS.INDEX_RELATIVE
  );

  const version = source.version ?? UNVERSIONED;
  const conflictStrategy = options.force ? 'overwrite' : options.conflictStrategy ?? 'ask';
  const platforms = await getDetectedPlatforms(cwd);

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
  record.index.packages[update.name] = {
    path: update.path,
    version: update.version,
    files: update.files
  };
  await writeWorkspaceIndex(record);
}
