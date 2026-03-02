/**
 * View Command (CLI layer)
 *
 * Thin shell over core/view/ pipeline.
 * Handles CLI arg parsing and delegates rendering to view-printers.
 */

import { basename } from 'path';
import type { Command } from 'commander';

import { CommandResult } from '@opkg/core/types/index.js';
import { ValidationError } from '@opkg/core/utils/errors.js';
import { getLocalPackageYmlPath } from '@opkg/core/utils/paths.js';
import { exists } from '@opkg/core/utils/fs.js';
import { parsePackageYml } from '@opkg/core/utils/package-yml.js';
import { createCliExecutionContext } from '../cli/context.js';
import {
  resolvePackageView,
  type ViewPipelineOptions,
} from '@opkg/core/core/view/view-pipeline.js';
import {
  printLocalPackageView,
  printRemotePackageView,
} from '@opkg/core/core/view/view-printers.js';

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

async function viewCommand(
  packageName: string,
  options: { global?: boolean; project?: boolean; files?: boolean; remote?: boolean; profile?: string; apiKey?: string },
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};

  if (options.project && options.global) {
    throw new ValidationError('Cannot use --project and --global together.');
  }

  if ((options.project || options.global) && options.remote) {
    throw new ValidationError('Cannot use --project/--global with --remote; choose one.');
  }

  const viewScope = options.global ? 'global' : options.project ? 'project' : undefined;

  const pipelineOptions: ViewPipelineOptions = {
    scope: viewScope,
    files: options.files,
    remote: options.remote,
    profile: options.profile,
    apiKey: options.apiKey,
    cwd: programOpts.cwd,
  };

  const result = await resolvePackageView(
    packageName,
    pipelineOptions,
    (opts) => createCliExecutionContext({ global: opts.global, cwd: opts.cwd })
  );

  switch (result.kind) {
    case 'local-package':
      printLocalPackageView(result.localResult, !!options.files);
      return { success: true };

    case 'remote':
      printRemotePackageView(result.remoteResult, !!options.files);
      return { success: true };

    case 'not-found':
      if (options.remote) {
        throw new ValidationError(`Package '${packageName}' not found remotely`);
      }
      throw new ValidationError(`Package '${packageName}' not found locally or remotely`);
  }
}

// ---------------------------------------------------------------------------
// Command setup
// ---------------------------------------------------------------------------

export async function setupViewCommand(args: any[]): Promise<void> {
  const [packageName, options, command] = args as [string | undefined, any, Command];

  let resolvedName = packageName;

  // If no package name provided, try to detect from workspace manifest
  if (!resolvedName) {
    const cwd = command.parent?.opts()?.cwd || process.cwd();
    const manifestPath = getLocalPackageYmlPath(cwd);

    if (await exists(manifestPath)) {
      try {
        const config = await parsePackageYml(manifestPath);
        resolvedName = config.name || basename(cwd);
      } catch {
        // Manifest exists but is unreadable/invalid — fall through to error
      }
    }

    if (!resolvedName) {
      throw new ValidationError(
        'Package name is required. Run this from a workspace with .openpackage/openpackage.yml or provide a package name.'
      );
    }
  }

  await viewCommand(resolvedName, options, command);
}
