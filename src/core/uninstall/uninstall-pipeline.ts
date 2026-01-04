import path from 'path';
import { readdir } from 'fs/promises';

import type { CommandResult, UninstallOptions } from '../../types/index.js';
import { ValidationError } from '../../utils/errors.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath } from '../../utils/paths.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { removeWorkspaceIndexEntry } from '../../utils/workspace-index-ownership.js';
import { applyRootFileRemovals, computeRootFileRemovalPlan } from '../../utils/root-file-uninstaller.js';
import { exists, remove, walkFiles } from '../../utils/fs.js';
import { isDirKey } from '../../utils/package-index-yml.js';
import { removePackageFromOpenpackageYml } from '../../utils/package-management.js';
import { getAllPlatformDirs } from '../../utils/platform-utils.js';
import { getPlatformRootFileNames } from '../../utils/platform-root-files.js';
import { getAllPlatforms } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import { removeFileMapping } from './flow-aware-uninstaller.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';

interface FileRemoval {
  workspacePath: string;
  key: string;
}

function isRootFileKey(key: string, rootNames: Set<string>): boolean {
  const normalized = key.replace(/\\/g, '/');
  return rootNames.has(normalized);
}

async function expandFilesFromIndex(
  cwd: string,
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  rootNames: Set<string>
): Promise<FileRemoval[]> {
  const removals: FileRemoval[] = [];

  for (const [rawKey, targets] of Object.entries(filesMapping || {})) {
    if (!Array.isArray(targets) || targets.length === 0) continue;

    const isDir = isDirKey(rawKey);
    if (isDir) {
      for (const mapping of targets) {
        const targetDir = getTargetPath(mapping);
        const absDir = path.join(cwd, targetDir);
        if (!(await exists(absDir))) continue;
        for await (const filePath of walkFiles(absDir)) {
          removals.push({ workspacePath: filePath, key: rawKey });
        }
      }
      continue;
    }

    // file key
    if (isRootFileKey(rawKey, rootNames)) {
      continue; // handled by root-file uninstaller
    }

    for (const mapping of targets) {
      const targetPath = getTargetPath(mapping);
      removals.push({ workspacePath: path.join(cwd, targetPath), key: rawKey });
    }
  }

  // Dedupe by workspace path
  const seen = new Set<string>();
  return removals.filter(removal => {
    if (seen.has(removal.workspacePath)) return false;
    seen.add(removal.workspacePath);
    return true;
  });
}

async function cleanupEmptyParents(
  cwd: string,
  deletedPaths: string[],
  platformRoots: Set<string>
): Promise<void> {
  const parents = new Set<string>();

  for (const p of deletedPaths) {
    let current = path.dirname(p);
    while (current.startsWith(cwd) && current !== cwd) {
      if (platformRoots.has(current)) break;
      parents.add(current);
      current = path.dirname(current);
    }
  }

  const sorted = Array.from(parents).sort((a, b) => b.length - a.length);
  for (const dir of sorted) {
    try {
      const entries = await readdir(dir);
      if (entries.length === 0 && !(platformRoots.has(dir))) {
        await remove(dir);
      }
    } catch {
      // ignore
    }
  }
}

export interface UninstallPipelineResult {
  removedFiles: string[];
  rootFilesUpdated: string[];
}

export async function runUninstallPipeline(
  packageName: string,
  options: UninstallOptions = {}
): Promise<CommandResult<UninstallPipelineResult>> {
  const cwd = process.cwd();
  const openpkgDir = getLocalOpenPackageDir(cwd);
  const manifestPath = getLocalPackageYmlPath(cwd);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${cwd}.`
    );
  }

  const { index, path: indexPath } = await readWorkspaceIndex(cwd);
  const pkgEntry = index.packages?.[packageName];

  if (!pkgEntry) {
    return { success: false, error: `Package '${packageName}' not found in workspace index.` };
  }

  const rootNames = getPlatformRootFileNames(getAllPlatforms(undefined, cwd), cwd);
  const plannedRemovals = await expandFilesFromIndex(cwd, pkgEntry.files || {}, rootNames);
  const rootPlan = await computeRootFileRemovalPlan(cwd, [packageName]);

  if (options.dryRun) {
    console.log(`(dry-run) Would remove ${plannedRemovals.length} files for ${packageName}`);
    for (const removal of plannedRemovals) {
      console.log(` - ${removal.workspacePath}`);
    }
    if (rootPlan.toUpdate.length > 0) {
      console.log(`Root files to update:`);
      rootPlan.toUpdate.forEach(f => console.log(` - ${f}`));
    }
    return {
      success: true,
      data: {
        removedFiles: plannedRemovals.map(r => r.workspacePath),
        rootFilesUpdated: rootPlan.toUpdate
      }
    };
  }

  const deleted: string[] = [];
  const updated: string[] = [];

  // Process file mappings using flow-aware removal
  for (const [sourceKey, mappings] of Object.entries(pkgEntry.files || {})) {
    for (const mapping of mappings) {
      const result = await removeFileMapping(cwd, mapping, packageName);
      deleted.push(...result.removed);
      updated.push(...result.updated);
    }
  }

  const rootResult = await applyRootFileRemovals(cwd, [packageName]);

  // Update workspace index
  removeWorkspaceIndexEntry(index, packageName);
  await writeWorkspaceIndex({ path: indexPath, index });

  // Update openpackage.yml
  await removePackageFromOpenpackageYml(cwd, packageName);

  // Cleanup empty dirs (avoid platform roots)
  const platformRoots = new Set(getAllPlatformDirs().map(dir => path.join(cwd, dir)));
  await cleanupEmptyParents(cwd, deleted, platformRoots);

  logger.info(`Uninstalled ${packageName}: removed ${deleted.length} files, updated ${updated.length} merged files`);

  return {
    success: true,
    data: {
      removedFiles: deleted,
      rootFilesUpdated: [...rootResult.updated, ...updated]
    }
  };
}
