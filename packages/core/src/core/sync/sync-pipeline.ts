/**
 * Sync Pipeline
 *
 * Main orchestrator for the sync command. Two entry points:
 * - runSyncPipeline(): single package
 * - runSyncAllPipeline(): all packages
 */

import type { ExecutionContext } from '../../types/execution-context.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type {
  SyncOptions,
  SyncFileAction,
  SyncFileResult,
  SyncPackageResult,
  SyncAllResult,
  SyncAllJsonOutput,
} from './sync-types.js';
import { readWorkspaceIndex, getWorkspaceIndexPath } from '../../utils/workspace-index-yml.js';
import { healAndPersistIndex } from '../../utils/workspace-index-healer.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { assertMutableSourceOrThrow } from '../source-mutability.js';
import { checkContentStatus, applyPendingHashUpdates } from '../list/content-status-checker.js';
import { classifyFileActions } from './sync-status-classifier.js';
import { executePushActions } from './sync-push-executor.js';
import { executePullActions } from './sync-pull-executor.js';
import { executeRemoveActions } from './sync-remove-executor.js';
import { executePullNewActions } from './sync-pull-new-executor.js';
import { detectNewSourceFiles } from './sync-source-scanner.js';
import { resolveConflictsInteractively } from './sync-conflict-resolver.js';
import {
  readSourcePackageVersion,
  readManifestRangeForDependency,
  checkVersionConstraint,
  resolveVersionMismatch,
  updateManifestRange,
  updateIndexVersion,
} from './sync-version-checker.js';
import type { VersionUpdateInfo } from './sync-version-checker.js';
import { discoverSyncablePackages } from './sync-discovery.js';
import { aggregateSyncFileResults, buildSyncAllResult, formatSyncMessage } from './sync-result-reporter.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { isUnversionedVersion } from '../package-versioning.js';
import { logger } from '../../utils/logger.js';
import { findPackageInIndex } from '../../utils/workspace-index-helpers.js';

// ---------------------------------------------------------------------------
// Single-package sync
// ---------------------------------------------------------------------------

/**
 * Run the sync pipeline for a single package.
 *
 * 1. Validate: package exists, has files, resolve source
 * 2. Assert mutable for push direction
 * 3. Status scan → classify → resolve conflicts → partition → execute
 */
export async function runSyncPipeline(
  packageName: string,
  targetDir: string,
  options: SyncOptions,
  ctx?: ExecutionContext,
): Promise<SyncPackageResult> {
  const cwd = targetDir;

  // Read workspace index
  const { index } = await readWorkspaceIndex(cwd);
  const match = findPackageInIndex(packageName, index.packages ?? {});
  if (!match) {
    throw new Error(
      `Package '${packageName}' is not installed in this workspace.\n` +
      `Run 'opkg install ${packageName}' to install it first.`
    );
  }
  const resolvedName = match.key;
  const pkgIndex = match.entry;

  if (!pkgIndex.files || Object.keys(pkgIndex.files).length === 0) {
    return aggregateSyncFileResults(resolvedName, []);
  }

  // Self-heal stale index entries (files deleted from disk)
  const healResult = await healAndPersistIndex(cwd, index, getWorkspaceIndexPath(cwd), resolvedName);
  if (healResult.healed && (!pkgIndex.files || Object.keys(pkgIndex.files).length === 0)) {
    return aggregateSyncFileResults(resolvedName, []);
  }

  // Resolve source
  const source = await resolvePackageSource(cwd, resolvedName);

  // Assert mutable for push direction
  if (options.direction !== 'pull') {
    assertMutableSourceOrThrow(source.absolutePath, {
      packageName: source.packageName,
      command: 'sync',
    });
  }

  const packageRoot = source.absolutePath;
  const filesMapping = pkgIndex.files;

  // Version constraint check (pull and bidirectional only)
  let versionUpdateInfo: VersionUpdateInfo | undefined;
  if (options.direction !== 'push') {
    const outcome = await checkAndResolveVersion(
      resolvedName, cwd, packageRoot, options, ctx,
    );
    if (outcome === 'skip') {
      return aggregateSyncFileResults(resolvedName, []);
    }
    if (outcome !== 'none') {
      versionUpdateInfo = outcome;
    }
  }

  // Status scan
  const { statusMap, pendingHashUpdates } = await checkContentStatus(cwd, packageRoot, filesMapping);
  if (pendingHashUpdates.size > 0) {
    try {
      await applyPendingHashUpdates(cwd, resolvedName, pendingHashUpdates);
    } catch (error) {
      logger.warn(`Failed to apply hash pivot recovery: ${error}`);
    }
  }

  // Classify into actions
  let actions = classifyFileActions(statusMap, options.direction, options.conflicts);

  if (actions.length === 0) {
    return aggregateSyncFileResults(resolvedName, []);
  }

  // Resolve conflicts interactively if needed
  const conflicts = actions.filter(a => a.type === 'conflict');
  if (conflicts.length > 0) {
    const prompt = resolvePrompt(ctx);
    const resolved = await resolveConflictsInteractively(conflicts, prompt);

    // Replace conflict actions with resolved ones
    const nonConflicts = actions.filter(a => a.type !== 'conflict');
    actions = [...nonConflicts, ...resolved];
  }

  // Partition into push, pull, remove, and skip
  const pushActions = actions.filter(a => a.type === 'push');
  const pullActions = actions.filter(a => a.type === 'pull');
  const removeActions = actions.filter(a => a.type === 'remove');
  const skipActions = actions.filter(a => a.type === 'skip');

  // Execute push, pull, and remove
  const allResults: SyncFileResult[] = [];

  // Add skip results
  for (const skip of skipActions) {
    allResults.push({
      sourceKey: skip.sourceKey,
      targetPath: skip.targetPath,
      action: 'skipped',
      detail: skip.type === 'skip' ? skip.reason : undefined,
    });
  }

  // Execute push (workspace → source)
  if (pushActions.length > 0) {
    const pushResults = await executePushActions(
      pushActions,
      resolvedName,
      packageRoot,
      cwd,
      filesMapping,
      options,
      ctx,
    );
    allResults.push(...pushResults);
  }

  // Execute pull (source → workspace)
  if (pullActions.length > 0) {
    const pullResults = await executePullActions(
      pullActions,
      resolvedName,
      packageRoot,
      cwd,
      filesMapping,
      options,
      ctx,
    );
    allResults.push(...pullResults);
  }

  // Execute remove (source-deleted stale files)
  if (removeActions.length > 0) {
    const removeResults = await executeRemoveActions(
      removeActions,
      resolvedName,
      cwd,
      filesMapping,
      options,
    );
    allResults.push(...removeResults);
  }

  // Detect and pull new source files (only in pull/bidirectional mode)
  if (options.direction !== 'push') {
    const existingKeys = new Set(Object.keys(filesMapping));
    const newFiles = await detectNewSourceFiles(packageRoot, cwd, existingKeys);
    if (newFiles.length > 0) {
      const newResults = await executePullNewActions(
        newFiles,
        resolvedName,
        packageRoot,
        cwd,
        options,
      );
      allResults.push(...newResults);
    }
  }

  const result = aggregateSyncFileResults(resolvedName, allResults);

  // Attach version update info
  if (versionUpdateInfo) {
    result.versionUpdate = versionUpdateInfo;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Version constraint check helper
// ---------------------------------------------------------------------------

/**
 * Check version constraints and resolve mismatches.
 * Returns version update info, 'skip', or 'none'.
 */
async function checkAndResolveVersion(
  packageName: string,
  cwd: string,
  packageRoot: string,
  options: SyncOptions,
  ctx?: ExecutionContext,
): Promise<VersionUpdateInfo | 'skip' | 'none'> {
  // Read source version and manifest range in parallel
  const [sourceVersion, manifestRange] = await Promise.all([
    readSourcePackageVersion(packageRoot),
    readManifestRangeForDependency(cwd, packageName),
  ]);

  // No source version or unversioned → unconstrained
  if (!sourceVersion || isUnversionedVersion(sourceVersion)) {
    return 'none';
  }

  const check = checkVersionConstraint(sourceVersion, manifestRange);

  if (check.status === 'unconstrained' || check.status === 'satisfied') {
    if (!options.dryRun) {
      await updateIndexVersion(cwd, packageName, sourceVersion);
    }
    return { newVersion: sourceVersion };
  }

  // Mismatch → resolve via shared cascade
  const prompt = resolvePrompt(ctx);
  const resolution = await resolveVersionMismatch(
    packageName, check, options, prompt, 'sync',
  );

  if (resolution.action === 'skip') {
    return 'skip';
  }

  if (!options.dryRun) {
    await updateManifestRange(cwd, packageName, sourceVersion, resolution.newRange);
    await updateIndexVersion(cwd, packageName, sourceVersion);
  }

  return {
    newVersion: sourceVersion,
    oldRange: manifestRange,
    newRange: resolution.newRange,
  };
}

// ---------------------------------------------------------------------------
// Sync-all
// ---------------------------------------------------------------------------

/**
 * Run sync for all packages that have actionable files.
 */
export async function runSyncAllPipeline(
  options: SyncOptions,
  ctx: ExecutionContext,
): Promise<SyncAllResult> {
  const targetDir = ctx.targetDir;
  const syncable = await discoverSyncablePackages(targetDir, options.direction);

  if (syncable.length === 0) {
    return buildSyncAllResult([], options.dryRun);
  }

  const packageResults: SyncAllJsonOutput['packages'] = [];

  for (const pkg of syncable) {
    try {
      const result = await runSyncPipeline(pkg.packageName, targetDir, options, ctx);

      if (result.pushed > 0 || result.pulled > 0 || result.removed > 0 || result.errors > 0) {
        packageResults.push({
          packageName: pkg.packageName,
          status: result.errors > 0 && result.pushed === 0 && result.pulled === 0 ? 'error' : 'synced',
          result,
          error: result.errors > 0 ? `${result.errors} file(s) failed` : undefined,
        });
      } else {
        packageResults.push({
          packageName: pkg.packageName,
          status: 'no-changes',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      packageResults.push({
        packageName: pkg.packageName,
        status: 'error',
        error: message,
      });
    }
  }

  return buildSyncAllResult(packageResults, options.dryRun);
}
