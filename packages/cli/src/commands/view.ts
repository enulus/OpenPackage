/**
 * View Command (CLI layer)
 *
 * Thin shell over core/view/ pipeline.
 * Handles CLI arg parsing and display rendering.
 */

import type { Command } from 'commander';

import { CommandResult } from '@opkg/core/types/index.js';
import { ValidationError } from '@opkg/core/utils/errors.js';
import { parseWorkspaceScope } from '@opkg/core/utils/scope-resolution.js';
import { createCliExecutionContext } from '../cli/context.js';
import {
  dim,
  sectionHeader,
  printResourcesView,
  printRemotePackageDetail,
  printMetadataSection,
} from '@opkg/core/core/list/list-printers.js';
import {
  resolvePackageView,
  type ViewPipelineOptions,
} from '@opkg/core/core/view/view-pipeline.js';
import { enhanceResourceGroups } from '@opkg/core/core/view/view-helpers.js';

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

async function viewCommand(
  packageName: string,
  options: { scope?: string; files?: boolean; remote?: boolean; profile?: string; apiKey?: string },
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};

  if (options.scope && options.remote) {
    throw new ValidationError('Cannot use --scope with --remote; choose one.');
  }

  let viewScope: 'project' | 'global' | undefined;
  if (options.scope) {
    try {
      viewScope = parseWorkspaceScope(options.scope);
    } catch (error) {
      throw error instanceof ValidationError ? error : new ValidationError(error instanceof Error ? error.message : String(error));
    }
  }

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
    case 'workspace-index': {
      if (result.resources.length === 0) {
        console.log(dim(`No resources found for package '${packageName}'.`));
        return { success: true };
      }
      printResourcesView(result.resources, !!options.files, result.headerInfo, {
        showScopeBadges: false,
        metadata: result.metadata,
      });
      if (result.dependencies.length > 0) {
        printDependenciesList(result.dependencies);
      }
      return { success: true };
    }
    case 'local-package': {
      const { report, headerInfo, scope, metadata } = result.localResult;
      const enhanced = enhanceResourceGroups(report, scope);

      if (enhanced.length > 0) {
        printResourcesView(enhanced, !!options.files, headerInfo, {
          showScopeBadges: false,
          pathBaseForDisplay: report.path,
          metadata,
        });
      } else {
        console.log(`${headerInfo.name}${headerInfo.version ? `@${headerInfo.version}` : ''} ${dim(`(${headerInfo.path})`)} ${dim(`[${headerInfo.type}]`)}`);
        printMetadataSection(metadata);
        console.log(sectionHeader('Resources', 0));
        console.log(dim('└── (no resources)'));
      }

      if (report.dependencies !== undefined) {
        printDependenciesList(report.dependencies);
      }
      return { success: true };
    }
    case 'remote':
      printRemotePackageDetail(result.remoteResult, !!options.files, true);
      return { success: true };

    case 'not-found':
      if (options.remote) {
        throw new ValidationError(`Package '${packageName}' not found remotely`);
      }
      throw new ValidationError(`Package '${packageName}' not found locally or remotely`);
  }
}

function printDependenciesList(dependencies: string[]): void {
  console.log(sectionHeader('Dependencies', dependencies.length));
  dependencies.forEach((dep, index) => {
    const isLast = index === dependencies.length - 1;
    console.log(`${isLast ? '└── ' : '├── '}${dep}`);
  });
}

// ---------------------------------------------------------------------------
// Command setup
// ---------------------------------------------------------------------------

export async function setupViewCommand(args: any[]): Promise<void> {
  const [packageName, options, command] = args as [string | undefined, any, Command];
  if (!packageName) {
    throw new ValidationError('Package name is required.');
  }
  await viewCommand(packageName, options, command);
}
