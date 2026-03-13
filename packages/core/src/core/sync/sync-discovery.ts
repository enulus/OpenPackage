/**
 * Sync Discovery
 *
 * Discovers packages that need syncing in either direction.
 * Extends the discoverModifiedPackages pattern from save-all-flow
 * to also detect outdated packages (source changed since install).
 */

import type { SyncDirection, SyncablePackageInfo } from './sync-types.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { checkContentStatus } from '../list/content-status-checker.js';
import { detectAllNewWorkspaceFiles } from '../save/save-new-file-detector.js';
import { detectNewSourceFiles } from './sync-source-scanner.js';
import { logger } from '../../utils/logger.js';

/**
 * Discover all packages that have actionable files for the given sync direction.
 *
 * - push: packages with modified or diverged files
 * - pull: packages with outdated files (source changed since install)
 * - bidirectional: union of both
 *
 * Skips immutable (registry) packages since they can't be pushed to.
 * For pull-only mode, registry packages are also skipped since their
 * source is read-only.
 */
export async function discoverSyncablePackages(
  targetDir: string,
  direction: SyncDirection,
): Promise<SyncablePackageInfo[]> {
  const { index } = await readWorkspaceIndex(targetDir);
  const packages = index.packages ?? {};
  const results: SyncablePackageInfo[] = [];

  for (const [packageName, pkgEntry] of Object.entries(packages)) {
    if (!pkgEntry.files || Object.keys(pkgEntry.files).length === 0) continue;

    // Resolve source
    let source;
    try {
      source = await resolvePackageSource(targetDir, packageName);
    } catch (error) {
      logger.debug(`Skipping ${packageName}: failed to resolve source: ${error}`);
      continue;
    }

    // Skip immutable packages — they can't be pushed to,
    // and their source is a local snapshot (pull from registry/git makes no sense)
    if (source.mutability === 'immutable') {
      logger.debug(`Skipping ${packageName}: immutable (${source.sourceType})`);
      continue;
    }

    // Content status check
    try {
      const { statusMap } = await checkContentStatus(
        targetDir,
        source.absolutePath,
        pkgEntry.files,
      );

      const directions = new Set<'push' | 'pull'>();

      for (const status of statusMap.values()) {
        if (status === 'modified' || status === 'merged') {
          directions.add('push');
        }
        if (status === 'outdated') {
          directions.add('pull');
        }
        if (status === 'source-deleted') {
          directions.add('pull');
        }
        if (status === 'diverged') {
          directions.add('push');
          directions.add('pull');
        }
      }

      // Also detect new untracked workspace files (push candidates)
      if (direction !== 'pull') {
        const newEntries = await detectAllNewWorkspaceFiles(pkgEntry.files, targetDir);
        if (Object.keys(newEntries).length > 0) {
          directions.add('push');
        }
      }

      // Also detect new source files not in the index (pull candidates)
      if (direction !== 'push') {
        const existingKeys = new Set(Object.keys(pkgEntry.files));
        const newFiles = await detectNewSourceFiles(source.absolutePath, targetDir, existingKeys);
        if (newFiles.length > 0) {
          directions.add('pull');
        }
      }

      // Filter by requested direction
      const relevant = filterDirections(directions, direction);
      if (relevant.size > 0) {
        results.push({ packageName, directions: relevant });
      }
    } catch (error) {
      logger.debug(`Status check failed for ${packageName}, including anyway: ${error}`);
      // If status check fails, include the package — let the pipeline decide
      const dirs = new Set<'push' | 'pull'>();
      if (direction !== 'pull') dirs.add('push');
      if (direction !== 'push') dirs.add('pull');
      results.push({ packageName, directions: dirs });
    }
  }

  return results;
}

function filterDirections(
  found: Set<'push' | 'pull'>,
  requested: SyncDirection,
): Set<'push' | 'pull'> {
  if (requested === 'bidirectional') return found;
  const filtered = new Set<'push' | 'pull'>();
  if (requested === 'push' && found.has('push')) filtered.add('push');
  if (requested === 'pull' && found.has('pull')) filtered.add('pull');
  return filtered;
}
