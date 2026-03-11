/**
 * Sync Command (CLI layer)
 *
 * Thin shell over core/sync/ pipelines.
 * Resolves a target to the appropriate sync pipeline,
 * then formats output for human or JSON consumption.
 */

import type { Command } from 'commander';

import { normalizeSyncOptions } from '@opkg/core/core/sync/sync-options-normalizer.js';
import { runDirectSyncFlow } from '@opkg/core/core/sync/sync-direct-flow.js';
import { runSyncAllPipeline } from '@opkg/core/core/sync/sync-pipeline.js';
import { formatSyncMessage, formatSyncAllSummary } from '@opkg/core/core/sync/sync-result-reporter.js';
import type { SyncAllResult, SyncPackageResult } from '@opkg/core/core/sync/sync-types.js';
import { getTreeConnector } from '@opkg/core/utils/formatters.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput } from '@opkg/core/core/ports/resolve.js';
import type { OutputPort } from '@opkg/core/core/ports/output.js';
import { printJsonSuccess, printJsonError } from '../utils/json-output.js';

interface SyncCommandOptions {
  push?: boolean;
  pull?: boolean;
  force?: boolean;
  conflicts?: string;
  dryRun?: boolean;
  json?: boolean;
  global?: boolean;
  platforms?: string[];
  prefer?: string;
}

export async function setupSyncCommand(args: any[]): Promise<void> {
  const [nameArg, options, command] = args as [string | undefined, SyncCommandOptions, Command];
  const programOpts = command.parent?.opts() || {};

  // Normalize options at CLI boundary
  const normalized = normalizeSyncOptions(options);

  // ── Sync-all path (no argument) ────────────────────────────────────
  if (!nameArg) {
    const ctx = await createCliExecutionContext({
      global: options.global,
      cwd: programOpts.cwd,
      interactive: false,
      outputMode: 'plain',
    });

    const allResult = await runSyncAllPipeline(normalized, ctx);

    if (options.json) {
      const { totals } = allResult.json;
      if (totals.packagesWithChanges === 0 && totals.packagesFailed > 0) {
        printJsonError(allResult.summary);
      } else {
        printJsonSuccess(allResult.json);
      }
    } else {
      const out = resolveOutput(ctx);
      const { totals } = allResult.json;
      if (totals.packagesWithChanges === 0 && totals.packagesFailed > 0) {
        throw new Error(allResult.summary);
      }
      printSyncAllResults(allResult, !!normalized.dryRun, out);
    }
    return;
  }

  // ── Single-target path ─────────────────────────────────────────────
  const traverseOpts = {
    programOpts,
    ...(options.global ? { globalOnly: true as const } : { projectOnly: true as const }),
  };
  const ctx = await createCliExecutionContext({
    cwd: programOpts.cwd,
    interactive: false,
    outputMode: 'plain',
  });

  const result = await runDirectSyncFlow(nameArg, normalized, traverseOpts, ctx);

  // JSON output path
  if (options.json) {
    if (result.cancelled) {
      printJsonSuccess({ cancelled: true });
      return;
    }
    if (!result.success) {
      printJsonError(result.error || 'Sync operation failed');
      return;
    }
    if (result.result) {
      printJsonSuccess(result.result);
    }
    return;
  }

  // Human-readable output path
  if (result.cancelled) {
    const out = resolveOutput(ctx);
    out.info('Sync cancelled');
    return;
  }

  if (!result.success) {
    throw new Error(result.error || 'Sync operation failed');
  }

  if (result.result) {
    const out = resolveOutput(ctx);
    const message = formatSyncMessage(result.result, normalized.dryRun);
    if (result.result.pushed > 0 || result.result.pulled > 0 || result.result.removed > 0) {
      out.success(message);
    } else {
      out.info(message);
    }
  }
}

function printSyncAllResults(
  allResult: SyncAllResult,
  dryRun: boolean,
  out: OutputPort,
): void {
  const prefix = dryRun ? '(dry-run) ' : '';

  for (const pkg of allResult.json.packages) {
    if (pkg.status === 'synced' && pkg.result) {
      const actionFiles = pkg.result.files.filter(f => f.action === 'pushed' || f.action === 'pulled');
      const seen = new Set<string>();
      const uniqueFiles = actionFiles.filter(f => {
        if (seen.has(f.sourceKey)) return false;
        seen.add(f.sourceKey);
        return true;
      });
      out.success(`${prefix}Synced ${pkg.packageName} (${uniqueFiles.length} files)`);
      for (let i = 0; i < uniqueFiles.length; i++) {
        const f = uniqueFiles[i];
        const connector = getTreeConnector(i === uniqueFiles.length - 1);
        const label = f.operation ? `(${f.operation})` : '';
        const direction = f.action === 'pushed' ? '\u2191' : '\u2193';
        out.info(`  ${connector}${f.sourceKey} ${direction} ${label}`.trimEnd());
      }
    } else if (pkg.status === 'error') {
      out.error(`\u2717 ${pkg.packageName}: ${pkg.error}`);
    } else {
      out.info(`- ${pkg.packageName}: no changes`);
    }
  }

  const { totals } = allResult.json;
  if (totals.packagesWithChanges > 0 || totals.packagesFailed > 0) {
    if (totals.packagesWithChanges > 0) {
      const parts: string[] = [`${totals.packagesWithChanges} package(s)`];
      if (totals.totalFilesPushed > 0) parts.push(`${totals.totalFilesPushed} file(s) pushed`);
      if (totals.totalFilesPulled > 0) parts.push(`${totals.totalFilesPulled} file(s) pulled`);
      out.success(`${prefix}Synced ${parts.join(', ')}`);
    }
    if (totals.packagesFailed > 0) {
      out.warn(`${totals.packagesFailed} package(s) failed`);
    }
  }
}
