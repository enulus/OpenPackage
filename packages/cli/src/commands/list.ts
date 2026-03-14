import { Command } from 'commander';

import { CommandResult } from '@opkg/core/types/index.js';
import { ValidationError } from '@opkg/core/utils/errors.js';
import { createCliExecutionContext } from '../cli/context.js';
import {
  collectScopedData,
  collectWorkspaceRootNames,
  mergeTrackedAndUntrackedResources,
  mergeResourcesAcrossScopes,
  resolveWorkspaceHeader,
  type HeaderInfo
} from '@opkg/core/core/list/scope-data-collector.js';
import { dim, printResourcesView, printProvenanceView } from '@opkg/core/core/list/list-printers.js';
import type { EnhancedResourceGroup, EnhancedResourceInfo, ResourceScope } from '@opkg/core/core/list/list-tree-renderer.js';
import { resolveProvenance, type ProvenanceResult } from '@opkg/core/core/resources/resource-provenance.js';
import { parseResourceQuery } from '@opkg/core/core/resources/resource-query.js';
import type { TraverseScopesOptions } from '@opkg/core/core/resources/scope-traversal.js';
import { printJsonSuccess } from '../utils/json-output.js';

interface ListOptions {
  global?: boolean;
  project?: boolean;
  files?: boolean;
  status?: boolean;
  platforms?: string[];
  flat?: boolean;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// JSON serialization helpers
// ---------------------------------------------------------------------------

function serializeResource(r: EnhancedResourceInfo) {
  return {
    name: r.name,
    status: r.status,
    scopes: [...r.scopes],
    packages: r.packages ? [...r.packages] : [],
    files: r.files.map(f => ({
      source: f.source,
      target: f.target,
      status: f.status,
      scope: f.scope,
    })),
    ...(r.version ? { version: r.version } : {}),
    ...(r.children?.length ? { children: r.children.map(serializeResource) } : {}),
  };
}

function serializeResourcesView(mergedResources: EnhancedResourceGroup[]) {
  return mergedResources.map(group => ({
    resourceType: group.resourceType,
    resources: group.resources.map(serializeResource),
  }));
}

function serializeProvenanceView(query: string, results: ProvenanceResult[]) {
  return {
    view: 'resource-provenance' as const,
    query,
    results: results.map(r => ({
      resourceName: r.resourceName,
      resourceType: r.resourceType,
      kind: r.kind,
      scope: r.scope,
      ...(r.packageName ? { packageName: r.packageName } : {}),
      ...(r.packageVersion ? { packageVersion: r.packageVersion } : {}),
      ...(r.packageSourcePath ? { packageSourcePath: r.packageSourcePath } : {}),
      files: r.files.map(f => f.target),
    })),
  };
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

/**
 * Build header info for a package-scoped or workspace-scoped listing.
 *
 * When `packageName` is given, uses the first result's target package metadata
 * and includes the scope badge. Otherwise resolves the workspace header.
 */
async function buildListHeaderInfo(
  packageName: string | undefined,
  results: Array<{ scope: ResourceScope; result: any }>,
  showProject: boolean,
  programOpts: Record<string, any>,
): Promise<HeaderInfo | undefined> {
  if (packageName) {
    const firstResult = results[0].result;
    const targetPkg = firstResult.data.targetPackage;
    return targetPkg
      ? {
          name: targetPkg.name,
          version: targetPkg.version !== '0.0.0' ? targetPkg.version : undefined,
          path: firstResult.headerPath,
          type: firstResult.headerType,
          scope: results[0].scope,
        }
      : {
          name: packageName,
          version: undefined,
          path: firstResult.headerPath,
          type: firstResult.headerType,
          scope: results[0].scope,
        };
  }

  if (showProject) {
    const projectContext = await createCliExecutionContext({
      global: false,
      cwd: programOpts.cwd,
    });
    return resolveWorkspaceHeader(projectContext);
  }

  return results.length > 0
    ? {
        name: results[0].result.headerName,
        version: results[0].result.headerVersion,
        path: results[0].result.headerPath,
        type: results[0].result.headerType,
      }
    : undefined;
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

  if (options.project && options.global) {
    throw new ValidationError('Cannot use --project and --global together.');
  }

  const explicitScope = options.project || options.global;
  const showProject = options.project || !explicitScope;
  const showGlobal = options.global || !explicitScope;

  // If input is a qualified resource spec (e.g. "skills/my-skill"), go directly to provenance.
  // We use parseResourceQuery to check whether the prefix is a known resource type,
  // so that package names containing `/` (e.g. "gh@user/repo") are not misrouted.
  if (packageName && parseResourceQuery(packageName).typeFilter) {
    return handleResourceProvenance(packageName, options, programOpts);
  }

  const results = await collectScopedData(
    packageName,
    {
      showProject,
      showGlobal,
      pipelineOptions: {
        files: options.files || options.status, // status implies file-level detail
        all: true, // Always build full tree: resources view needs it to collect from transitive deps
        status: options.status,
        platforms: options.platforms
      },
      cwd: programOpts.cwd
    },
    (opts) => createCliExecutionContext({ global: opts.global, cwd: opts.cwd })
  );

  if (results.length === 0) {
    if (packageName) {
      // Package not found — fall back to resource provenance lookup
      return handleResourceProvenance(packageName, options, programOpts);
    }
    if (options.json) {
      printJsonSuccess({ view: 'resources', resources: [] });
      return { success: true };
    }
    console.log(dim('No resources found.'));
    return { success: true };
  }

  // --- Resources view ---
  const scopedResources: Array<{ scope: ResourceScope; groups: EnhancedResourceGroup[] }> = [];

  const workspaceRootNames = collectWorkspaceRootNames(results);

  for (const { scope, result } of results) {
    // When listing a specific package, don't include untracked files
    const untrackedData = packageName ? undefined : result.data.untrackedFiles;
    const merged = mergeTrackedAndUntrackedResources(result.tree, untrackedData, scope, workspaceRootNames, !!options.flat);
    if (merged.length > 0) {
      scopedResources.push({ scope, groups: merged });
    }
  }

  if (scopedResources.length === 0) {
    if (options.json) {
      printJsonSuccess({ view: 'resources', resources: [] });
      return { success: true };
    }
    if (packageName) {
      console.log(dim(`No resources found for package '${packageName}'.`));
    } else {
      console.log(dim('No resources found.'));
    }
    return { success: true };
  }

  const mergedResources = mergeResourcesAcrossScopes(scopedResources);

  if (options.json) {
    printJsonSuccess({ view: 'resources', resources: serializeResourcesView(mergedResources) });
    return { success: true };
  }

  const listHeaderInfo = await buildListHeaderInfo(packageName, results, showProject, programOpts);
  printResourcesView(mergedResources, !!options.files, listHeaderInfo, undefined, !!options.status);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Resource provenance fallback (absorbed from `which`)
// ---------------------------------------------------------------------------

async function handleResourceProvenance(
  input: string,
  options: ListOptions,
  programOpts: Record<string, any>,
): Promise<CommandResult> {
  const traverseOpts: TraverseScopesOptions = {
    programOpts,
    ...(options.global && { globalOnly: true }),
    ...(options.project && { projectOnly: true }),
  };

  const provenanceResults = await resolveProvenance(input, traverseOpts, { status: !!options.status });

  if (provenanceResults.length === 0) {
    if (options.json) {
      printJsonSuccess(serializeProvenanceView(input, []));
      return { success: true };
    }
    console.log(dim(`No package or resource named '${input}' found.`));
    console.log(dim('Hint: try `opkg view <name>` for package details.'));
    return { success: true };
  }

  if (options.json) {
    printJsonSuccess(serializeProvenanceView(input, provenanceResults));
    return { success: true };
  }

  printProvenanceView(input, provenanceResults, { files: !!options.files, status: !!options.status });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Command setup
// ---------------------------------------------------------------------------

export async function setupListCommand(args: any[]): Promise<void> {
  const [packageName, options, command] = args as [string | undefined, ListOptions, Command];
  await listCommand(packageName, options, command);
}
