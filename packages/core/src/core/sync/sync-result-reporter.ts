/**
 * Sync Result Reporter
 *
 * Formats sync results for both human-readable and JSON output.
 */

import type {
  SyncPackageResult,
  SyncAllResult,
  SyncAllJsonOutput,
  SyncFileResult,
} from './sync-types.js';
import { getTreeConnector } from '../../utils/formatters.js';

// ---------------------------------------------------------------------------
// Human-readable formatting
// ---------------------------------------------------------------------------

/**
 * Format a single-package sync result for human display.
 */
export function formatSyncMessage(result: SyncPackageResult, dryRun?: boolean): string {
  const prefix = dryRun ? '(dry-run) ' : '';
  const lines: string[] = [];

  if (result.pushed === 0 && result.pulled === 0 && result.removed === 0 && result.errors === 0) {
    return `${prefix}Synced ${result.packageName}\n  No changes detected`;
  }

  lines.push(`${prefix}Synced ${result.packageName}`);

  const parts: string[] = [];
  if (result.pushed > 0) parts.push(`${result.pushed} file(s) pushed`);
  if (result.pulled > 0) parts.push(`${result.pulled} file(s) pulled`);
  if (result.removed > 0) parts.push(`${result.removed} file(s) removed`);
  if (result.skipped > 0) parts.push(`${result.skipped} file(s) skipped`);
  if (parts.length > 0) lines.push(`  ${parts.join(', ')}`);

  // Pushed files
  const pushed = result.files.filter(f => f.action === 'pushed');
  if (pushed.length > 0) {
    lines.push('  Pushed:');
    appendFileTree(lines, pushed);
  }

  // Pulled files
  const pulled = result.files.filter(f => f.action === 'pulled');
  if (pulled.length > 0) {
    lines.push('  Pulled:');
    appendFileTree(lines, pulled);
  }

  // Removed files
  const removed = result.files.filter(f => f.action === 'removed');
  if (removed.length > 0) {
    lines.push('  Removed:');
    appendFileTree(lines, removed);
  }

  // Errors
  const errors = result.files.filter(f => f.action === 'error');
  if (errors.length > 0) {
    lines.push('');
    lines.push(`  ${errors.length} error(s):`);
    for (const err of errors) {
      lines.push(`   - ${err.targetPath}: ${err.detail || 'unknown error'}`);
    }
  }

  return lines.join('\n');
}

function dedupBySourceKey(files: SyncFileResult[]): SyncFileResult[] {
  const seen = new Set<string>();
  return files.filter(f => {
    if (seen.has(f.sourceKey)) return false;
    seen.add(f.sourceKey);
    return true;
  });
}

function appendFileTree(lines: string[], files: SyncFileResult[]): void {
  const deduped = dedupBySourceKey(files);
  const sorted = [...deduped].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  for (let i = 0; i < sorted.length; i++) {
    const connector = getTreeConnector(i === sorted.length - 1);
    const label = sorted[i].operation ? `(${sorted[i].operation})` : '';
    lines.push(`   ${connector}${sorted[i].sourceKey} ${label}`.trimEnd());
  }
}

// ---------------------------------------------------------------------------
// Sync-all formatting
// ---------------------------------------------------------------------------

/**
 * Build sync-all summary string for human display.
 */
export function formatSyncAllSummary(
  json: SyncAllJsonOutput,
  dryRun?: boolean,
): string {
  const prefix = dryRun ? '(dry-run) ' : '';
  const { totals } = json;

  if (totals.packagesWithChanges === 0 && totals.packagesFailed === 0) {
    return 'No packages need syncing';
  }

  const summaryLines: string[] = [];
  for (const pkg of json.packages) {
    if (pkg.status === 'synced' && pkg.result) {
      const parts: string[] = [];
      if (pkg.result.pushed > 0) parts.push(`${pkg.result.pushed} pushed`);
      if (pkg.result.pulled > 0) parts.push(`${pkg.result.pulled} pulled`);
      if (pkg.result.removed > 0) parts.push(`${pkg.result.removed} removed`);
      summaryLines.push(`  \u2713 ${pkg.packageName}: ${parts.join(', ')}`);
    } else if (pkg.status === 'error') {
      summaryLines.push(`  \u2717 ${pkg.packageName}: ${pkg.error}`);
    } else {
      summaryLines.push(`  - ${pkg.packageName}: no changes`);
    }
  }

  const headerParts: string[] = [];
  if (totals.packagesWithChanges > 0) {
    headerParts.push(`${totals.packagesWithChanges} package(s)`);
  }
  if (totals.totalFilesPushed > 0) {
    headerParts.push(`${totals.totalFilesPushed} file(s) pushed`);
  }
  if (totals.totalFilesPulled > 0) {
    headerParts.push(`${totals.totalFilesPulled} file(s) pulled`);
  }
  if (totals.totalFilesRemoved > 0) {
    headerParts.push(`${totals.totalFilesRemoved} file(s) removed`);
  }

  const header = headerParts.length > 0
    ? `${prefix}Synced ${headerParts.join(', ')}`
    : `${prefix}No changes to sync`;
  const failureLine = totals.packagesFailed > 0
    ? `\n  ${totals.packagesFailed} package(s) failed`
    : '';

  return `${header}\n${summaryLines.join('\n')}${failureLine}`;
}

// ---------------------------------------------------------------------------
// Result aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Aggregate per-file results into a SyncPackageResult.
 */
export function aggregateSyncFileResults(
  packageName: string,
  files: SyncFileResult[],
): SyncPackageResult {
  return {
    packageName,
    pushed: dedupBySourceKey(files.filter(f => f.action === 'pushed')).length,
    pulled: dedupBySourceKey(files.filter(f => f.action === 'pulled')).length,
    removed: dedupBySourceKey(files.filter(f => f.action === 'removed')).length,
    skipped: dedupBySourceKey(files.filter(f => f.action === 'skipped')).length,
    errors: files.filter(f => f.action === 'error').length,
    files,
  };
}

/**
 * Build a SyncAllResult from per-package results.
 */
export function buildSyncAllResult(
  packageResults: SyncAllJsonOutput['packages'],
  dryRun?: boolean,
): SyncAllResult {
  let totalFilesPushed = 0;
  let totalFilesPulled = 0;
  let totalFilesRemoved = 0;
  let packagesWithChanges = 0;
  let packagesFailed = 0;

  for (const pkg of packageResults) {
    if (pkg.status === 'synced' && pkg.result) {
      if (pkg.result.pushed > 0 || pkg.result.pulled > 0 || pkg.result.removed > 0) {
        packagesWithChanges++;
      }
      totalFilesPushed += pkg.result.pushed;
      totalFilesPulled += pkg.result.pulled;
      totalFilesRemoved += pkg.result.removed;
    } else if (pkg.status === 'error') {
      packagesFailed++;
    }
  }

  const json: SyncAllJsonOutput = {
    packages: packageResults,
    totals: {
      packagesProcessed: packageResults.length,
      packagesWithChanges,
      packagesFailed,
      totalFilesPushed,
      totalFilesPulled,
      totalFilesRemoved,
    },
  };

  return {
    json,
    summary: formatSyncAllSummary(json, dryRun),
  };
}
