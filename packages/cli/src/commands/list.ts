import { Command } from 'commander';

import { CommandResult } from '@opkg/core/types/index.js';
import { ValidationError } from '@opkg/core/utils/errors.js';
import { parseWorkspaceScope } from '@opkg/core/utils/scope-resolution.js';
import { createCliExecutionContext } from '../cli/context.js';
import {
  collectScopedData,
  mergeTrackedAndUntrackedResources,
  mergeResourcesAcrossScopes,
  resolveWorkspaceHeader,
  type HeaderInfo
} from '@opkg/core/core/list/scope-data-collector.js';
import { dim, printDepsView, printResourcesView } from '@opkg/core/core/list/list-printers.js';
import type { EnhancedResourceGroup, ResourceScope } from '@opkg/core/core/list/list-tree-renderer.js';

interface ListOptions {
  scope?: string;
  files?: boolean;
  tracked?: boolean;
  untracked?: boolean;
  platforms?: string[];
  deps?: boolean;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

async function listCommand(
  packageName: string | undefined,
  options: ListOptions,
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};

  if (options.tracked && options.untracked) {
    throw new ValidationError('Cannot use --tracked and --untracked together.');
  }

  if (packageName && options.untracked) {
    throw new ValidationError('Cannot use --untracked with a specific package.');
  }

  if (options.deps && options.untracked) {
    throw new ValidationError('Cannot use --deps with --untracked.');
  }

  let showProject: boolean;
  let showGlobal: boolean;
  if (options.scope) {
    try {
      const scope = parseWorkspaceScope(options.scope);
      showProject = scope === 'project';
      showGlobal = scope === 'global';
    } catch (error) {
      throw error instanceof ValidationError
        ? error
        : new ValidationError(error instanceof Error ? error.message : String(error));
    }
  } else {
    showProject = true;
    showGlobal = true;
  }

  const results = await collectScopedData(
    packageName,
    {
      showProject,
      showGlobal,
      pipelineOptions: {
        files: options.files,
        all: true, // Always build full tree: deps view needs it for display, resources view needs it to collect from transitive deps
        tracked: options.tracked,
        untracked: options.untracked,
        platforms: options.platforms
      },
      cwd: programOpts.cwd
    },
    (opts) => createCliExecutionContext({ global: opts.global, cwd: opts.cwd })
  );

  if (results.length === 0) {
    if (packageName) {
      console.log(dim(`Package '${packageName}' is not installed.`));
    } else if (options.deps) {
      console.log(dim('No packages installed.'));
    } else {
      console.log(dim('No resources found.'));
    }
    return { success: true };
  }

  // --- Compute header ---
  let listHeaderInfo: HeaderInfo | undefined;
  if (packageName) {
    // For specific package, use the package's own header from the first result
    const firstResult = results[0].result;
    const targetPkg = firstResult.data.targetPackage;
    listHeaderInfo = targetPkg
      ? {
          name: targetPkg.name,
          version: targetPkg.version !== '0.0.0' ? targetPkg.version : undefined,
          path: firstResult.headerPath,
          type: firstResult.headerType
        }
      : {
          name: packageName,
          version: undefined,
          path: firstResult.headerPath,
          type: firstResult.headerType
        };
  } else if (showProject) {
    const projectContext = await createCliExecutionContext({
      global: false,
      cwd: programOpts.cwd
    });
    listHeaderInfo = await resolveWorkspaceHeader(projectContext);
  } else {
    listHeaderInfo = results.length > 0
      ? {
          name: results[0].result.headerName,
          version: results[0].result.headerVersion,
          path: results[0].result.headerPath,
          type: results[0].result.headerType
        }
      : undefined;
  }

  // --- Deps view ---
  if (options.deps) {
    printDepsView(results, !!options.files, listHeaderInfo);
    return { success: true };
  }

  // --- Resources view (default) ---
  const scopedResources: Array<{ scope: ResourceScope; groups: EnhancedResourceGroup[] }> = [];

  for (const { scope, result } of results) {
    // When listing a specific package, don't include untracked files
    const untrackedData = packageName || options.tracked ? undefined : result.data.untrackedFiles;
    const merged = mergeTrackedAndUntrackedResources(result.tree, untrackedData, scope);
    if (merged.length > 0) {
      scopedResources.push({ scope, groups: merged });
    }
  }

  if (scopedResources.length === 0) {
    if (packageName) {
      console.log(dim(`No resources found for package '${packageName}'.`));
    } else if (options.untracked) {
      console.log(dim('No untracked resources found.'));
    } else {
      console.log(dim('No resources found.'));
    }
    return { success: true };
  }

  let mergedResources = mergeResourcesAcrossScopes(scopedResources);

  if (options.untracked) {
    mergedResources = mergedResources
      .map(group => ({
        ...group,
        resources: group.resources.filter(r => r.status === 'untracked')
      }))
      .filter(group => group.resources.length > 0);

    if (mergedResources.length === 0) {
      console.log(dim('No untracked resources found.'));
      return { success: true };
    }
  }

  printResourcesView(mergedResources, !!options.files, listHeaderInfo);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Command setup
// ---------------------------------------------------------------------------

export async function setupListCommand(args: any[]): Promise<void> {
  const [packageName, options, command] = args as [string | undefined, ListOptions, Command];
  await listCommand(packageName, options, command);
}
