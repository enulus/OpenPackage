import path from 'path';

import type { CommandResult, UninstallOptions, ExecutionContext } from '../../types/index.js';
import { ValidationError } from '../../utils/errors.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath } from '../../utils/paths.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { healAndPersistIndex } from '../../utils/workspace-index-healer.js';
import { removeWorkspaceIndexEntry, removeWorkspaceIndexFileKeys } from '../../utils/workspace-index-ownership.js';
import { processRootFileRemovals } from '../platform/root-file-uninstaller.js';
import { exists, remove, walkFiles } from '../../utils/fs.js';
import { isDirKey } from '../../utils/package-index-yml.js';
import { removePackageFromOpenpackageYml } from '../package-management.js';
import { getPlatformRootFileNames } from '../platform/platform-root-files.js';
import { getAllPlatforms } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import { removeFileMapping } from './flow-aware-uninstaller.js';
import { getTargetPath, findPackageInIndex } from '../../utils/workspace-index-helpers.js';
import { getEmbeddedChildren } from '../../utils/qualified-name.js';
import { buildPreservedDirectoriesSet } from '../platform/directory-preservation.js';
import { cleanupEmptyParents } from '../../utils/cleanup-empty-parents.js';
import { removeLockfileEntry } from '../../utils/lockfile-yml.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

interface ProcessFileMappingsOptions {
  dryRun?: boolean;
}

interface ProcessFileMappingsResult {
  removed: string[];
  updated: string[];
}

function isRootFileKey(key: string, rootNames: Set<string>): boolean {
  const normalized = key.replace(/\\/g, '/');
  return rootNames.has(normalized);
}

async function processFileMappings(
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  targetDir: string,
  packageName: string,
  rootNames: Set<string>,
  options: ProcessFileMappingsOptions = {}
): Promise<ProcessFileMappingsResult> {
  const removed: string[] = [];
  const updated: string[] = [];
  const seenPaths = new Set<string>();

  for (const [rawKey, mappings] of Object.entries(filesMapping || {})) {
    if (!Array.isArray(mappings) || mappings.length === 0) continue;

    const isDir = isDirKey(rawKey);

    if (isDir) {
      for (const mapping of mappings) {
        const targetPath = getTargetPath(mapping);
        const absDir = path.join(targetDir, targetPath);
        if (!(await exists(absDir))) continue;

        if (options.dryRun) {
          for await (const filePath of walkFiles(absDir)) {
            if (!seenPaths.has(filePath)) {
              seenPaths.add(filePath);
              removed.push(filePath);
            }
          }
        } else {
          const result = await removeFileMapping(targetDir, mapping, packageName);
          removed.push(...result.removed);
          updated.push(...result.updated);
        }
      }
      continue;
    }

    if (isRootFileKey(rawKey, rootNames)) {
      continue;
    }

    for (const mapping of mappings) {
      const targetPath = getTargetPath(mapping);
      const absPath = path.join(targetDir, targetPath);

      if (options.dryRun) {
        if (!seenPaths.has(absPath)) {
          seenPaths.add(absPath);
          removed.push(absPath);
        }
      } else {
        const result = await removeFileMapping(targetDir, mapping, packageName);
        removed.push(...result.removed);
        updated.push(...result.updated);
      }
    }
  }

  return { removed, updated };
}

export interface UninstallPipelineResult {
  removedFiles: string[];
  rootFilesUpdated: string[];
}

export async function runUninstallPipeline(
  packageName: string,
  options: UninstallOptions = {},
  execContext: ExecutionContext
): Promise<CommandResult<UninstallPipelineResult>> {
  // Use targetDir for uninstall operations
  const targetDir = execContext.targetDir;
  const openpkgDir = getLocalOpenPackageDir(targetDir);
  const manifestPath = getLocalPackageYmlPath(targetDir);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${targetDir}.`
    );
  }

  // Look up package with multi-strategy matching (exact, case-insensitive, normalized, resource name)
  const { index, path: indexPath } = await readWorkspaceIndex(targetDir);

  // Self-heal stale index entries before uninstall
  await healAndPersistIndex(targetDir, index, indexPath);

  const match = findPackageInIndex(packageName, index.packages || {});

  if (!match) {
    return { success: false, error: `Package '${packageName}' not found in workspace index.` };
  }

  const resolvedName = match.key;
  const pkgEntry = match.entry;

  // Check for embedded children
  const childKeys = getEmbeddedChildren(index.packages || {}, resolvedName);

  if (childKeys.length > 0 && !options.recursive) {
    // Warn about orphaned children
    const childList = childKeys.map(k => `  - ${k}`).join('\n');
    logger.warn(
      `Package '${resolvedName}' has ${childKeys.length} embedded package(s):\n${childList}\n` +
      `Use --recursive to uninstall them together.`
    );
  }

  if (options.recursive && childKeys.length > 0) {
    const rootNames = getPlatformRootFileNames(getAllPlatforms(undefined, targetDir), targetDir);
    // Uninstall children first (reverse order for clean dependency removal)
    for (const childKey of childKeys.reverse()) {
      const childMatch = findPackageInIndex(childKey, index.packages || {});
      if (!childMatch) continue;

      const { removed: childDeleted } = await processFileMappings(
        childMatch.entry.files || {},
        targetDir,
        childMatch.key,
        rootNames,
        { dryRun: false }
      );

      await processRootFileRemovals(targetDir, [childMatch.key]);
      removeWorkspaceIndexEntry(index, childMatch.key);
      await removeLockfileEntry(targetDir, childMatch.key);
      await removePackageFromOpenpackageYml(targetDir, childMatch.key);

      logger.info(`Uninstalled embedded package ${childMatch.key}: removed ${childDeleted.length} files`);
    }
  }

  const rootNames = getPlatformRootFileNames(getAllPlatforms(undefined, targetDir), targetDir);

  if (options.dryRun) {
    const out = resolveOutput(execContext);
    const plannedRemovals = await processFileMappings(
      pkgEntry.files || {},
      targetDir,
      resolvedName,
      rootNames,
      { dryRun: true }
    );
    const rootPlan = await processRootFileRemovals(targetDir, [resolvedName], { dryRun: true });
    out.info(`(dry-run) Would remove ${plannedRemovals.removed.length} files for ${resolvedName}`);
    for (const filePath of plannedRemovals.removed) {
      out.info(` - ${filePath}`);
    }
    if (rootPlan.updated.length > 0) {
      out.info(`Root files to update:`);
      rootPlan.updated.forEach(f => out.info(` - ${f}`));
    }
    return {
      success: true,
      data: {
        removedFiles: plannedRemovals.removed,
        rootFilesUpdated: rootPlan.updated
      }
    };
  }

  const { removed: deleted, updated } = await processFileMappings(
    pkgEntry.files || {},
    targetDir,
    resolvedName,
    rootNames,
    { dryRun: false }
  );

  const rootResult = await processRootFileRemovals(targetDir, [resolvedName]);

  // Update workspace index (migration will happen on write)
  removeWorkspaceIndexEntry(index, resolvedName);
  await writeWorkspaceIndex({ path: indexPath, index });

  // Clean up lockfile entry
  await removeLockfileEntry(targetDir, resolvedName);

  // Update openpackage.yml (migration will happen on write)
  await removePackageFromOpenpackageYml(targetDir, resolvedName);

  // Cleanup empty directories (preserve platform roots from detection patterns)
  const preservedDirs = buildPreservedDirectoriesSet(targetDir);
  // Convert relative paths to absolute paths for cleanup
  const deletedAbsolutePaths = deleted.map(relativePath => path.join(targetDir, relativePath));
  await cleanupEmptyParents(targetDir, deletedAbsolutePaths, preservedDirs);

  logger.info(`Uninstalled ${resolvedName}: removed ${deleted.length} files, updated ${updated.length} merged files`);

  return {
    success: true,
    data: {
      removedFiles: deleted,
      rootFilesUpdated: [...rootResult.updated, ...updated]
    }
  };
}

export async function runSelectiveUninstallPipeline(
  packageName: string,
  sourceKeysToRemove: Set<string>,
  options: UninstallOptions = {},
  execContext: ExecutionContext
): Promise<CommandResult<UninstallPipelineResult>> {
  const targetDir = execContext.targetDir;
  const openpkgDir = getLocalOpenPackageDir(targetDir);
  const manifestPath = getLocalPackageYmlPath(targetDir);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${targetDir}.`
    );
  }

  const { index, path: indexPath } = await readWorkspaceIndex(targetDir);
  const match = findPackageInIndex(packageName, index.packages || {});

  if (!match) {
    return { success: false, error: `Package '${packageName}' not found in workspace index.` };
  }

  const resolvedName = match.key;
  const pkgEntry = match.entry;

  const filteredFiles: Record<string, (string | WorkspaceIndexFileMapping)[]> = {};
  for (const key of sourceKeysToRemove) {
    if (pkgEntry.files[key]) {
      filteredFiles[key] = pkgEntry.files[key];
    }
  }

  const rootNames = getPlatformRootFileNames(getAllPlatforms(undefined, targetDir), targetDir);

  if (options.dryRun) {
    const out = resolveOutput(execContext);
    const plannedRemovals = await processFileMappings(
      filteredFiles,
      targetDir,
      resolvedName,
      rootNames,
      { dryRun: true }
    );
    out.info(`(dry-run) Would remove ${plannedRemovals.removed.length} files for ${resolvedName}`);
    for (const filePath of plannedRemovals.removed) {
      out.info(` - ${filePath}`);
    }
    return {
      success: true,
      data: {
        removedFiles: plannedRemovals.removed,
        rootFilesUpdated: []
      }
    };
  }

  const { removed: deleted, updated } = await processFileMappings(
    filteredFiles,
    targetDir,
    resolvedName,
    rootNames,
    { dryRun: false }
  );

  removeWorkspaceIndexFileKeys(index, resolvedName, sourceKeysToRemove);
  await writeWorkspaceIndex({ path: indexPath, index });

  // Clean lockfile if package has no files remaining
  const updatedEntry = index.packages[resolvedName];
  if (!updatedEntry || Object.keys(updatedEntry.files ?? {}).length === 0) {
    await removeLockfileEntry(targetDir, resolvedName);
  }

  const preservedDirs = buildPreservedDirectoriesSet(targetDir);
  const deletedAbsolutePaths = deleted.map(relativePath => path.join(targetDir, relativePath));
  await cleanupEmptyParents(targetDir, deletedAbsolutePaths, preservedDirs);

  logger.info(`Selectively uninstalled from ${resolvedName}: removed ${deleted.length} files, updated ${updated.length} merged files`);

  return {
    success: true,
    data: {
      removedFiles: deleted,
      rootFilesUpdated: updated
    }
  };
}
