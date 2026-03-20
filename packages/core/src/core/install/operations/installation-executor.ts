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
import { installPackageByIndexWithFlows as installPackageByIndex, type IndexInstallResult } from '../flow-index-installer.js';
import type { RelocatedFile } from '../conflicts/file-conflict-resolver.js';
import type { IndexWriteCollector } from '../wave-resolver/index-write-collector.js';
import { checkAndHandleAllPackageConflicts } from './conflict-handler.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../../utils/workspace-index-yml.js';
import { deduplicateTargets } from '../../../utils/workspace-index-helpers.js';
import type { PromptPort } from '../../ports/prompt.js';
import type { InstallScope, WorkspaceIndexFileMapping } from '../../../types/workspace-index.js';

export type ConflictSummary = Awaited<ReturnType<typeof checkAndHandleAllPackageConflicts>>;

export interface InstallationPhasesParams {
  cwd: string;
  packages: ResolvedPackage[];
  platforms: Platform[];
  conflictResult?: ConflictSummary;
  options: InstallOptions;
  targetDir: string;
  matchedPattern?: string;
  prompt?: PromptPort;
  indexWriteCollector?: IndexWriteCollector;
  sharedOwnershipContext?: import('../conflicts/file-conflict-resolver.js').OwnershipContext;
  installScope?: InstallScope;
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
  /** True when namespace conflict resolution was triggered for any package */
  namespaced?: boolean;
  /** Paths of files that were installed/updated under namespace conflict resolution */
  namespacedFiles?: string[];
  /** Files that were physically relocated on disk during namespace resolution */
  relocatedFiles?: RelocatedFile[];
  /** Absolute paths of files that were auto-claimed (content identical, unowned on disk) */
  claimedFiles?: string[];
}

/**
 * Perform the index-based installation process
 *
 * Installs each package using the index-based installer and handles root files.
 */
export async function performIndexBasedInstallationPhases(params: InstallationPhasesParams): Promise<InstallationPhasesResult> {
  const { cwd, packages, platforms, conflictResult, options, targetDir, matchedPattern, prompt, indexWriteCollector, sharedOwnershipContext } = params;

  let totalInstalled = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allAddedFiles: string[] = [];
  const allUpdatedFiles: string[] = [];
  const allDeletedFiles: string[] = [];
  const errors: string[] = [];
  const allNamespacedFiles: string[] = [];
  const allClaimedFiles: string[] = [];
  const allRelocatedFiles: RelocatedFile[] = [];

  for (const resolved of packages) {
    try {
      // Extract originalContentRoot if it was stored during conversion
      const originalContentRoot = (resolved as any).originalContentRoot;

      // Check if the package-level conflict phase confirmed an overwrite for this package
      const forceOverwrite = conflictResult?.forceOverwritePackages?.has(resolved.name) ?? false;
      
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
        originalContentRoot,  // Pass original path for index writing
        forceOverwrite,        // Phase 5: propagate package-level overwrite decision
        prompt,
        indexWriteCollector,
        sharedOwnershipContext,
        undefined,  // sourceType
        params.installScope
      );

      totalInstalled += installResult.installed;
      totalUpdated += installResult.updated;
      totalDeleted += installResult.deleted;
      totalSkipped += installResult.skipped;

      allAddedFiles.push(...installResult.installedFiles);
      allUpdatedFiles.push(...installResult.updatedFiles);
      allDeletedFiles.push(...installResult.deletedFiles);

      // Aggregate namespace metadata
      if (installResult.namespacedFiles) {
        allNamespacedFiles.push(...installResult.namespacedFiles);
      }
      if (installResult.claimedFiles) {
        allClaimedFiles.push(...installResult.claimedFiles);
      }
      if (installResult.relocatedFiles) {
        allRelocatedFiles.push(...installResult.relocatedFiles);
      }

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

  /** Per-package root files to augment workspace index */
  const rootFileAugmentations = new Map<string, { rootFilePaths: string[] }>();

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

      // Collect root files for index augmentation
      if (!options.dryRun) {
        const rootFilePaths = [...installResult.created, ...installResult.updated];
        if (rootFilePaths.length > 0) {
          rootFileAugmentations.set(resolved.name, { rootFilePaths });
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
    if (indexWriteCollector) {
      // Defer to collector (parallel install mode)
      for (const [packageName, { rootFilePaths }] of rootFileAugmentations) {
        const files: Record<string, (string | WorkspaceIndexFileMapping)[]> = {};
        for (const p of rootFilePaths) {
          files[p] = [{ target: p, merge: 'composite', keys: [packageName] }];
        }
        indexWriteCollector.recordFileAugmentation({ packageName, files });
      }
    } else {
      try {
        const wsRecord = await readWorkspaceIndex(cwd);
        wsRecord.index.packages = wsRecord.index.packages ?? {};
        for (const [packageName, { rootFilePaths }] of rootFileAugmentations) {
          const entry = wsRecord.index.packages[packageName];
          if (!entry) continue;
          const files = { ...(entry.files ?? {}) };
          for (const p of rootFilePaths) {
            const incoming: WorkspaceIndexFileMapping = { target: p, merge: 'composite', keys: [packageName] };
            const existing = files[p] ?? [];
            files[p] = deduplicateTargets(existing, [incoming]);
          }
          wsRecord.index.packages[packageName] = { ...entry, files };
        }
        await writeWorkspaceIndex(wsRecord);
        logger.debug(`Augmented workspace index with root files for ${rootFileAugmentations.size} package(s)`);
      } catch (error) {
        logger.warn(`Failed to augment workspace index with root files: ${error}`);
      }
    }
  }

  // Deduplicate: remove any root files that also appear in allAddedFiles/allUpdatedFiles
  const addedSet = new Set(allAddedFiles);
  const updatedSet = new Set(allUpdatedFiles);
  const dedupedRootInstalled = Array.from(rootFileResults.installed).filter(
    f => !addedSet.has(f)
  );
  const dedupedRootUpdated = Array.from(rootFileResults.updated).filter(
    f => !updatedSet.has(f)
  );

  return {
    installedCount: totalInstalled,
    skippedCount: totalSkipped,
    errorCount: totalErrors,
    allAddedFiles,
    errors: errors.length > 0 ? errors : undefined,
    allUpdatedFiles,
    rootFileResults: {
      installed: dedupedRootInstalled,
      updated: dedupedRootUpdated,
      skipped: Array.from(rootFileResults.skipped)
    },
    totalOpenPackageFiles: totalInstalled + totalUpdated,
    namespaced: allNamespacedFiles.length > 0 || undefined,
    namespacedFiles: allNamespacedFiles.length > 0 ? allNamespacedFiles : undefined,
    relocatedFiles: allRelocatedFiles.length > 0 ? allRelocatedFiles : undefined,
    claimedFiles: allClaimedFiles.length > 0 ? allClaimedFiles : undefined
  };
}
