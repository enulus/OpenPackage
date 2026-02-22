/**
 * Uninstall Command (CLI layer)
 *
 * Thin shell over core/uninstall/ pipelines.
 * Handles CLI arg parsing, spinner display, and result formatting.
 */

import { join } from 'path';
import type { Command } from 'commander';

import type { UninstallOptions } from '@opkg/core/types/index.js';
import { ValidationError } from '@opkg/core/utils/errors.js';
import { formatPathForDisplay } from '@opkg/core/utils/formatters.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput, resolvePrompt } from '@opkg/core/core/ports/resolve.js';
import { runDirectUninstallFlow } from '@opkg/core/core/uninstall/direct-uninstall-flow.js';
import { executeUninstallCandidate } from '@opkg/core/core/uninstall/uninstall-executor.js';
import {
  collectWorkspaceResources,
  buildGroupedUninstallOptions,
  executeBatchUninstall,
  type UninstallChoiceValue,
} from '@opkg/core/core/uninstall/workspace-resource-collector.js';

interface UninstallCommandOptions extends UninstallOptions {
  global?: boolean;
  interactive?: boolean;
}

async function uninstallCommand(
  nameArg: string | undefined,
  options: UninstallCommandOptions,
  command: Command
) {
  const programOpts = command.parent?.opts() || {};
  const traverseOpts = {
    programOpts,
    ...(options.global ? { globalOnly: true as const } : { projectOnly: true as const }),
  };

  if (options.interactive) {
    await handleListUninstall(nameArg, options, programOpts, traverseOpts);
    return;
  }

  if (!nameArg) {
    throw new ValidationError('Resource or package name is required. Use --interactive to interactively select.');
  }

  const result = await runDirectUninstallFlow(
    nameArg,
    options,
    traverseOpts,
    (opts) => createCliExecutionContext(opts),
  );

  if (result.cancelled) {
    const ctx = await createCliExecutionContext({ interactive: false });
    resolveOutput(ctx).info('Uninstall cancelled');
  }
}

// ---------------------------------------------------------------------------
// Interactive selection: opkg un --interactive [package-name]
// ---------------------------------------------------------------------------

async function handleListUninstall(
  packageFilter: string | undefined,
  options: UninstallCommandOptions,
  programOpts: Record<string, any>,
  traverseOpts: { programOpts?: Record<string, any>; globalOnly?: boolean; projectOnly?: boolean }
) {
  const ctx = await createCliExecutionContext({ interactive: true });
  const out = resolveOutput(ctx);
  const prm = resolvePrompt(ctx);

  const s = out.spinner();
  s.start('Loading installed resources');

  const collection = await collectWorkspaceResources(traverseOpts, packageFilter);

  if (packageFilter && collection.allResources.length === 0 && collection.allPackages.length === 0) {
    s.stop('No resources found');
    throw new ValidationError(`Package '${packageFilter}' not found.`);
  }

  const { groupedOptions, totalItems } = await buildGroupedUninstallOptions(collection, programOpts);

  if (totalItems === 0) {
    s.stop('No installed resources found');
    out.note('Run `opkg install --interactive` to install resources.', 'Info');
    return;
  }

  s.stop(`Found ${totalItems} item${totalItems === 1 ? '' : 's'}`);

  const selected = await prm.groupMultiselect<UninstallChoiceValue>(
    'Select items to uninstall:',
    groupedOptions
  );

  if (!selected || selected.length === 0) {
    out.info('Uninstall cancelled');
    return;
  }

  out.step(`Uninstalling ${selected.length} item${selected.length === 1 ? '' : 's'}`);

  const summary = await executeBatchUninstall(
    selected,
    options,
    collection,
    programOpts,
    (opts) => createCliExecutionContext(opts),
    executeUninstallCandidate
  );

  // Display results
  const breakdown = Array.from(summary.typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');

  out.success(`Successfully uninstalled ${summary.uninstalledCount} item${summary.uninstalledCount === 1 ? '' : 's'} (${breakdown})`);

  if (summary.allRemovedFiles.length > 0) {
    const cwd = process.cwd();
    const absolutePaths = [...new Set(
      summary.allRemovedFiles.map(({ path: p, targetDir }) => join(targetDir, p))
    )].sort((a, b) => a.localeCompare(b));
    const displayFiles = absolutePaths.slice(0, 10);
    const fileLines = displayFiles.map(f => formatPathForDisplay(f, cwd));
    const more = absolutePaths.length > 10 ? `\n... and ${absolutePaths.length - 10} more` : '';
    out.note(fileLines.join('\n') + more, 'Removed files');
  }

  out.success('Uninstall complete');
}

// ---------------------------------------------------------------------------
// Command setup
// ---------------------------------------------------------------------------

export async function setupUninstallCommand(args: any[]): Promise<void> {
  const [nameArg, options, command] = args as [string | undefined, UninstallCommandOptions, Command];
  await uninstallCommand(nameArg, options, command);
}
