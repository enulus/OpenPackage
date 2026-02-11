/**
 * Installation Executor
 *
 * Contains the index-based installation logic for executing package installations.
 * Migrated from install-flow.ts to support the unified pipeline.
 */

import { InstallOptions } from '../../../types/index.js';
import type { ResolvedPackage } from '../../dependency-resolver/types.js';
import { type Platform } from '../../platforms.js';
import { logger } from '../../../utils/logger.js';
import { UserCancellationError } from '../../../utils/errors.js';
import { discoverAndCategorizeFiles } from '../helpers/file-discovery.js';
import { installOrSyncRootFiles } from './root-files.js';
import { installPackageByIndexWithFlows as installPackageByIndex, type IndexInstallResult } from '../../../utils/flow-index-installer.js';
import { ensureDir, exists, writeTextFile } from '../../../utils/fs.js';
import { dirname, join } from 'path';
import { checkAndHandleAllPackageConflicts } from './conflict-handler.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../../utils/workspace-index-yml.js';
import { PACKAGE_ROOT_DIRS } from '../../../constants/index.js';

export type ConflictSummary = Awaited<ReturnType<typeof checkAndHandleAllPackageConflicts>>;

export interface InstallationPhasesParams {
  cwd: string;
  packages: ResolvedPackage[];
  platforms: Platform[];
  conflictResult: ConflictSummary;
  options: InstallOptions;
  targetDir: string;
  matchedPattern?: string;
}

export interface InstallationPhasesResult {
  installedCount: number;
  skippedCount: number;
  errorCount: number;
  allAddedFiles: string[];
  allUpdatedFiles: string[];
  rootFileResults: { installed: string[]; updated: string[]; skipped: string[] };
  totalOpenPackageFiles: number;
  errors?: string[];
}

/**
 * Perform the index-based installation process
 *
 * Installs each package using the index-based installer and handles root files.
 */
export async function performIndexBasedInstallationPhases(params: InstallationPhasesParams): Promise<InstallationPhasesResult> {
  const { cwd, packages, platforms, conflictResult, options, targetDir, matchedPattern } = params;

  let totalInstalled = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allAddedFiles: string[] = [];
  const allUpdatedFiles: string[] = [];
  const allDeletedFiles: string[] = [];
  const errors: string[] = [];

  for (const resolved of packages) {
    try {
      // Extract originalContentRoot if it was stored during conversion
      const originalContentRoot = (resolved as any).originalContentRoot;
      
      const installResult: IndexInstallResult = await installPackageByIndex(
        cwd,
        resolved.name,
        resolved.version,
        platforms,
        options,
        resolved.contentRoot,
        resolved.pkg._format,
        resolved.marketplaceMetadata,
        matchedPattern,
        resolved.resourceVersion,
        originalContentRoot  // Pass original path for index writing
      );

      totalInstalled += installResult.installed;
      totalUpdated += installResult.updated;
      totalDeleted += installResult.deleted;
      totalSkipped += installResult.skipped;

      allAddedFiles.push(...installResult.installedFiles);
      allUpdatedFiles.push(...installResult.updatedFiles);
      allDeletedFiles.push(...installResult.deletedFiles);

      if (installResult.installed > 0 || installResult.updated > 0 || installResult.deleted > 0) {
        logger.info(`Index-based install for ${resolved.name}: ${installResult.installed} installed, ${installResult.updated} updated, ${installResult.deleted} deleted`);
      }
    } catch (error) {
      if (error instanceof UserCancellationError) {
        throw error;
      }
      const errorMsg = `Failed index-based install for ${resolved.name}: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
      totalErrors++;
    }
  }

  // Handle root files separately
  const rootFileResults = {
    installed: new Set<string>(),
    updated: new Set<string>(),
    skipped: new Set<string>()
  };

  /** Per-package root files + root copy paths to augment workspace index */
  const rootFileAugmentations = new Map<string, { rootFilePaths: string[]; rootCopyPaths: string[] }>();

  for (const resolved of packages) {
    try {
      const categorized = await discoverAndCategorizeFiles(
        resolved.name,
        resolved.version,
        platforms,
        resolved.contentRoot,
        matchedPattern
      );
      const installResult = await installOrSyncRootFiles(
        cwd,
        resolved.name,
        categorized.rootFiles,
        platforms
      );

      installResult.created.forEach(file => rootFileResults.installed.add(file));
      installResult.updated.forEach(file => rootFileResults.updated.add(file));
      installResult.skipped.forEach(file => rootFileResults.skipped.add(file));

      // Copy root/** files directly to workspace root (strip prefix)
      for (const file of categorized.rootCopyFiles) {
        const targetPath = join(cwd, file.path);
        const parent = dirname(targetPath);
        await ensureDir(parent);
        const existed = await exists(targetPath);
        await writeTextFile(targetPath, file.content, (file.encoding as BufferEncoding) ?? 'utf8');
        if (existed) {
          rootFileResults.updated.add(file.path);
        } else {
          rootFileResults.installed.add(file.path);
        }
      }

      // Collect root files + root copy for index augmentation
      if (!options.dryRun) {
        const rootFilePaths = [...installResult.created, ...installResult.updated];
        const rootCopyPaths = categorized.rootCopyFiles.map(f => f.path);
        if (rootFilePaths.length > 0 || rootCopyPaths.length > 0) {
          rootFileAugmentations.set(resolved.name, { rootFilePaths, rootCopyPaths });
        }
      }
    } catch (error) {
      if (error instanceof UserCancellationError) {
        throw error;
      }
      const errorMsg = `Failed root file install for ${resolved.name}: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
      totalErrors++;
    }
  }

  // Augment workspace index with root files and root copy files (flow-installer writes index before root phase)
  if (!options.dryRun && rootFileAugmentations.size > 0) {
    try {
      const wsRecord = await readWorkspaceIndex(cwd);
      wsRecord.index.packages = wsRecord.index.packages ?? {};
      for (const [packageName, { rootFilePaths, rootCopyPaths }] of rootFileAugmentations) {
        const entry = wsRecord.index.packages[packageName];
        if (!entry) continue;
        const files = { ...(entry.files ?? {}) };
        for (const path of rootFilePaths) {
          const existing = files[path] ?? [];
          if (!existing.includes(path)) {
            files[path] = [...existing, path];
          }
        }
        const rootPrefix = `${PACKAGE_ROOT_DIRS.ROOT_COPY}/`;
        for (const path of rootCopyPaths) {
          const registryKey = `${rootPrefix}${path}`;
          const existing = files[registryKey] ?? [];
          if (!existing.includes(path)) {
            files[registryKey] = [...existing, path];
          }
        }
        wsRecord.index.packages[packageName] = { ...entry, files };
      }
      await writeWorkspaceIndex(wsRecord);
      logger.debug(`Augmented workspace index with root files for ${rootFileAugmentations.size} package(s)`);
    } catch (error) {
      logger.warn(`Failed to augment workspace index with root files: ${error}`);
    }
  }

  return {
    installedCount: totalInstalled,
    skippedCount: totalSkipped,
    errorCount: totalErrors,
    allAddedFiles,
    errors: errors.length > 0 ? errors : undefined,
    allUpdatedFiles,
    rootFileResults: {
      installed: Array.from(rootFileResults.installed),
      updated: Array.from(rootFileResults.updated),
      skipped: Array.from(rootFileResults.skipped)
    },
    totalOpenPackageFiles: totalInstalled + totalUpdated
  };
}
