/**
 * Move Pipeline
 *
 * Core orchestrator for the `opkg move` command. Supports six scenarios:
 * - Rename-only: in-place rename within the same package (source-only)
 * - Relocate-only: move resource from one package to another (source-only)
 * - Rename + Relocate: rename and move in one step (source-only)
 * - Adopt: bring untracked workspace resources into a package via --to
 * - Eject: detach a tracked resource from its package, keeping workspace files
 * - Workspace rename: rename an untracked resource in the workspace
 *
 * After source-level changes, new files are synced to the workspace and the
 * workspace index is updated so that `ls`, `view`, and `status` reflect the move.
 */

import { join } from 'path';

import type { CommandResult } from '../../types/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import type { ResolvedResource } from '../resources/resource-builder.js';
import { classifyResourceSpec, resolveResourceSpec, type ResolvedTarget } from '../resources/resource-spec.js';
import { parseResourceQuery } from '../resources/resource-query.js';
import { resolveFromSource, formatCandidateTitle, formatCandidateDescription } from '../resources/resource-resolver.js';
import { disambiguate } from '../resources/disambiguation-prompt.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import { isProjectScopedPath } from '../scope-resolution.js';
import { addSourceEntriesToPackage } from '../add/add-to-source-pipeline.js';
import { performMoveCleanup } from '../add/move-cleanup.js';
import { renameEntries } from '../add/entry-renamer.js';
import { walkFiles, remove } from '../../utils/fs.js';
import { getRelativePathFromBase } from '../../utils/path-normalization.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { validateMoveArgs, validateNotNoop } from './move-validator.js';
import { executeInPlaceRename } from './move-rename-executor.js';
import { executeWorkspaceRename as executeWorkspaceRenameOnDisk } from './move-workspace-rename-executor.js';
import { collectRemovalEntries } from '../remove/removal-collector.js';
import { cleanupEmptyParents } from '../../utils/cleanup-empty-parents.js';
import { disambiguatePlatform, groupFilesByPlatform } from '../platform/platform-disambiguation.js';
import { discoverResources } from '../install/resource-discoverer.js';
import type { ResourceType } from '../install/resource-types.js';
import { buildEntriesFromWorkspaceResource } from '../resources/workspace-resource-discovery.js';
import type { SourceEntry } from '../add/source-collector.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { findPackageInIndex } from '../../utils/workspace-index-helpers.js';
import { removeWorkspaceIndexFileKeys } from '../../utils/workspace-index-ownership.js';
import { detectNewSourceFiles } from '../sync/sync-source-scanner.js';
import { executePullNewActions } from '../sync/sync-pull-new-executor.js';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MoveOptions {
  to?: string;
  from?: string;
  platform?: string;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface MoveResult {
  action: 'rename' | 'relocate' | 'rename-relocate' | 'adopt' | 'eject' | 'workspace-rename';
  sourcePath: string;
  sourcePackage?: string;
  resourceName: string;
  newName?: string;
  destPackage?: string;
  renamedFiles?: number;
  movedFiles?: number;
  ejectedFiles?: number;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runMovePipeline(
  resourceInput: string,
  newName: string | undefined,
  options: MoveOptions,
  execContext: ExecutionContext,
): Promise<CommandResult<MoveResult>> {
  const cwd = execContext.targetDir;

  // 1. Validate arguments
  try {
    validateMoveArgs(newName, options.to, options.from);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  // 2. Validate flag combinations
  if (options.platform && options.from) {
    return { success: false, error: '--platform cannot be used with --from.' };
  }

  // 3. Classify and resolve the resource spec
  const classification = classifyResourceSpec(resourceInput);

  if (classification.kind !== 'resource-ref') {
    return {
      success: false,
      error:
        `"${resourceInput}" does not look like a resource reference.\n` +
        'Expected format: <type>/<name> (e.g., agents/my-agent, skills/my-skill)',
    };
  }

  let resolved: ResolvedTarget[];

  if (options.from) {
    // --from specified: resolve directly from the package source
    resolved = await resolveFromPackageSource(
      resourceInput, options.from, execContext,
    );
    if (resolved.length === 0) {
      return {
        success: false,
        error: `Resource "${resourceInput}" not found in package "${options.from}".`,
      };
    }
  } else {
    // No --from: resolve via workspace index
    const traverseOpts = { programOpts: { cwd: execContext.sourceCwd } };
    try {
      resolved = await resolveResourceSpec(
        resourceInput,
        traverseOpts,
        {
          scopePreference: 'project',
          notFoundMessage:
            `Resource "${resourceInput}" not found.\n` +
            'Run `opkg ls` to see installed resources.',
        },
        execContext,
      );
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (resolved.length === 0) {
    return {
      success: false,
      error: `Resource "${resourceInput}" not found.\nRun \`opkg ls\` to see installed resources.`,
    };
  }

  const target = resolved[0];
  const candidate = target.candidate;

  if (candidate.kind !== 'resource' || !candidate.resource) {
    return {
      success: false,
      error: `"${resourceInput}" resolved to a package, not a resource. Use \`opkg move\` with a resource reference.`,
    };
  }

  const resource = candidate.resource;
  const resourceName = resource.resourceName;
  const sourcePackage = resource.packageName;
  const packageSourcePath = target.packageSourcePath;
  const typeDir = parseResourceQuery(resourceInput).typeFilter
    ? resourceInput.split('/')[0]
    : undefined;

  // Route untracked resources to workspace-rename or adopt flow
  if (!sourcePackage) {
    // Untracked rename: newName provided, no --to needed
    if (newName && !options.to) {
      if (newName === resourceName) {
        return { success: false, error: `Nothing to do: "${resourceName}" is already named "${newName}".` };
      }
      if (options.dryRun) {
        return {
          success: true,
          data: {
            action: 'workspace-rename',
            sourcePath: cwd,
            resourceName,
            newName,
            renamedFiles: resource.targetFiles.length,
            dryRun: true,
          },
        };
      }
      try {
        return await executeWorkspaceRename(resource, resourceName, newName, target.targetDir);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (!options.to) {
      return {
        success: false,
        error: `Resource "${resourceInput}" is untracked (not owned by any package).\nUse --to <package> to adopt it, or provide a <new-name> to rename it.`,
      };
    }

    // Platform disambiguation: filter targetFiles to a single platform when multi-platform
    let effectiveTargetFiles = resource.targetFiles;
    const platformGroups = groupFilesByPlatform(resource.targetFiles, cwd);
    const platformKeys = [...platformGroups.keys()].filter((k): k is string => k !== null);

    if (platformKeys.length > 1) {
      try {
        const selectedPlatform = await disambiguatePlatform({
          targetDir: cwd,
          resourceLabel: resourceInput,
          specifiedPlatform: options.platform,
          execContext,
        });
        const platformFiles = platformGroups.get(selectedPlatform) ?? [];
        const universalFiles = platformGroups.get(null) ?? [];
        effectiveTargetFiles = [...platformFiles, ...universalFiles];
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const effectiveResource = effectiveTargetFiles === resource.targetFiles
      ? resource
      : { ...resource, targetFiles: effectiveTargetFiles };

    const isRename = !!newName && newName !== resourceName;

    if (options.dryRun) {
      return {
        success: true,
        data: {
          action: 'adopt',
          sourcePath: cwd,
          resourceName,
          newName: isRename ? newName : undefined,
          destPackage: options.to,
          movedFiles: effectiveResource.targetFiles.length,
          dryRun: true,
        },
      };
    }

    try {
      return await executeAdopt(
        effectiveResource, resourceName, newName, options, execContext, target.targetDir,
      );
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (!packageSourcePath) {
    return {
      success: false,
      error: `Could not resolve source path for package "${sourcePackage}".`,
    };
  }

  // If --from is specified, verify it matches
  if (options.from && options.from !== sourcePackage) {
    return {
      success: false,
      error: `Resource "${resourceInput}" belongs to package "${sourcePackage}", not "${options.from}".`,
    };
  }

  // Detect eject: tracked resource, --from specified, no --to, no newName
  if (options.from && !options.to && !newName) {
    if (options.dryRun) {
      return {
        success: true,
        data: {
          action: 'eject',
          sourcePath: packageSourcePath,
          sourcePackage,
          resourceName,
          ejectedFiles: resource.sourceKeys.size,
          dryRun: true,
        },
      };
    }
    try {
      return await executeEject(resource, packageSourcePath, execContext);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // 3. Validate not a no-op
  try {
    validateNotNoop(resourceName, newName, sourcePackage, options.to);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  // 4. Determine scenario
  const isRename = !!newName && newName !== resourceName;
  const isRelocate = !!options.to && options.to !== sourcePackage;
  const action: MoveResult['action'] = isRename && isRelocate
    ? 'rename-relocate'
    : isRename
      ? 'rename'
      : 'relocate';

  // 5. Dry-run: return preview without executing
  if (options.dryRun) {
    return {
      success: true,
      data: {
        action,
        sourcePath: packageSourcePath,
        sourcePackage,
        resourceName,
        newName: isRename ? newName : undefined,
        destPackage: isRelocate ? options.to : undefined,
        renamedFiles: isRename ? resource.sourceKeys.size : undefined,
        movedFiles: isRelocate ? resource.sourceKeys.size : undefined,
        dryRun: true,
      },
    };
  }

  // 6. Execute based on scenario
  try {
    if (action === 'rename') {
      return await executeRename(
        packageSourcePath, resource.sourceKeys, resourceName, newName!,
        sourcePackage,
      );
    }

    // relocate or rename-relocate: shared flow
    return await executeRelocate(
      packageSourcePath, resource, resourceName, newName,
      isRename, action, options, execContext, target.targetDir,
    );
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeRename(
  packageSourcePath: string,
  sourceKeys: Set<string>,
  resourceName: string,
  newName: string,
  sourcePackage: string,
): Promise<CommandResult<MoveResult>> {
  const renameResult = await executeInPlaceRename(
    packageSourcePath, sourceKeys, resourceName, newName,
  );

  return {
    success: true,
    data: {
      action: 'rename',
      sourcePath: packageSourcePath,
      sourcePackage,
      resourceName,
      newName,
      renamedFiles: renameResult.renamedFiles,
      dryRun: false,
    },
  };
}

async function executeRelocate(
  packageSourcePath: string,
  resource: ResolvedResource,
  resourceName: string,
  newName: string | undefined,
  isRename: boolean,
  action: MoveResult['action'],
  options: MoveOptions,
  execContext: ExecutionContext,
  resourceTargetDir: string,
): Promise<CommandResult<MoveResult>> {
  let entries = await buildEntriesFromPackageSource(packageSourcePath, resource);

  if (isRename && newName) {
    entries = await renameEntries(entries, resourceName, newName);
  }

  const addResult = await addSourceEntriesToPackage(
    options.to, entries, { force: options.force, execContext },
  );

  if (!addResult.success) {
    return { success: false, error: addResult.error ?? 'Failed to add resource to destination package.' };
  }

  await performMoveCleanup({ resource, packageSourcePath, execContext, resourceTargetDir });
  await postMoveSyncAndCleanup(options.to!, resource, execContext.targetDir);

  return {
    success: true,
    data: {
      action,
      sourcePath: packageSourcePath,
      sourcePackage: resource.packageName!,
      resourceName,
      newName: isRename ? newName : undefined,
      destPackage: options.to,
      renamedFiles: isRename ? entries.length : undefined,
      movedFiles: addResult.data?.filesAdded,
      dryRun: false,
    },
  };
}

async function executeAdopt(
  resource: ResolvedResource,
  resourceName: string,
  newName: string | undefined,
  options: MoveOptions,
  execContext: ExecutionContext,
  resourceTargetDir: string,
): Promise<CommandResult<MoveResult>> {
  let entries = await buildEntriesFromWorkspaceResource(
    resource.resourceType,
    resourceName,
    resource.targetFiles,
    resourceTargetDir,
  );

  const isRename = !!newName && newName !== resourceName;
  if (isRename && newName) {
    entries = await renameEntries(entries, resourceName, newName);
  }

  const addResult = await addSourceEntriesToPackage(
    options.to, entries, { force: options.force, execContext },
  );

  if (!addResult.success) {
    return { success: false, error: addResult.error ?? 'Failed to add resource to destination package.' };
  }

  await performMoveCleanup({ resource, packageSourcePath: undefined, execContext, resourceTargetDir });
  await postMoveSyncAndCleanup(options.to!, resource, execContext.targetDir);

  return {
    success: true,
    data: {
      action: 'adopt',
      sourcePath: resourceTargetDir,
      resourceName,
      newName: isRename ? newName : undefined,
      destPackage: options.to,
      movedFiles: addResult.data?.filesAdded,
      dryRun: false,
    },
  };
}

async function executeEject(
  resource: ResolvedResource,
  packageSourcePath: string,
  execContext: ExecutionContext,
): Promise<CommandResult<MoveResult>> {
  const sourcePackage = resource.packageName!;

  // 1. Remove source files from package
  const deletedAbsPaths: string[] = [];
  for (const sourceKey of resource.sourceKeys) {
    try {
      const removalEntries = await collectRemovalEntries(packageSourcePath, sourceKey);
      for (const entry of removalEntries) {
        await remove(entry.packagePath);
        deletedAbsPaths.push(entry.packagePath);
      }
    } catch (error) {
      logger.debug(`Eject: skipping source key "${sourceKey}"`, { error });
    }
  }

  // 2. Cleanup empty parent directories in package source
  if (deletedAbsPaths.length > 0) {
    await cleanupEmptyParents(packageSourcePath, deletedAbsPaths);
  }

  // 3. Remove workspace index entries (prevents sync from deleting workspace files)
  try {
    const record = await readWorkspaceIndex(execContext.targetDir);
    removeWorkspaceIndexFileKeys(record.index, sourcePackage, resource.sourceKeys);
    await writeWorkspaceIndex(record);
  } catch (error) {
    logger.warn(`Failed to update workspace index during eject: ${error}`);
  }

  // 4. Workspace files intentionally left untouched

  return {
    success: true,
    data: {
      action: 'eject',
      sourcePath: packageSourcePath,
      sourcePackage,
      resourceName: resource.resourceName,
      ejectedFiles: deletedAbsPaths.length,
      dryRun: false,
    },
  };
}

async function executeWorkspaceRename(
  resource: ResolvedResource,
  resourceName: string,
  newName: string,
  targetDir: string,
): Promise<CommandResult<MoveResult>> {
  const result = await executeWorkspaceRenameOnDisk(resource.resourceType, resourceName, newName, targetDir);
  return {
    success: true,
    data: {
      action: 'workspace-rename',
      sourcePath: targetDir,
      resourceName,
      newName,
      renamedFiles: result.renamedFiles,
      dryRun: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build SourceEntry[] from a package source directory using disk-based discovery.
 *
 * When the resource already carries `sourcePath` and `installKind` (e.g. from the
 * --from resolution path which already ran discoverResources), those are used
 * directly to avoid a redundant full-package discovery. Otherwise falls back to
 * discoverResources() for the workspace-index resolution path.
 */
async function buildEntriesFromPackageSource(
  packageSourcePath: string,
  resource: ResolvedResource,
): Promise<SourceEntry[]> {
  let filePath = resource.sourcePath;
  let installKind = resource.installKind;

  if (!filePath || !installKind) {
    // Workspace-index resolution path: sourcePath/installKind not populated.
    // Discover from disk to avoid trusting stale sourceKeys.
    const discovery = await discoverResources(packageSourcePath, packageSourcePath);
    const matched = (discovery.byType.get(resource.resourceType as ResourceType) ?? []).find(
      r => r.displayName === resource.resourceName,
    );

    if (!matched) {
      throw new Error(
        `Resource "${resource.resourceType}/${resource.resourceName}" not found on disk in package at ${packageSourcePath}. ` +
        'The workspace index may be stale — try running `opkg sync` first.',
      );
    }

    filePath = matched.filePath;
    installKind = matched.installKind;
  }

  if (installKind === 'directory') {
    const entries: SourceEntry[] = [];
    for await (const file of walkFiles(filePath)) {
      const registryPath = getRelativePathFromBase(file, packageSourcePath);
      entries.push({ sourcePath: file, registryPath });
    }
    return entries;
  }

  // file-based resource
  const registryPath = getRelativePathFromBase(filePath, packageSourcePath);
  return [{ sourcePath: filePath, registryPath }];
}

/**
 * Post-move reconciliation: sync new target files into the workspace, then
 * remove stale source keys from the origin package (if any).
 */
async function postMoveSyncAndCleanup(
  targetPackage: string,
  resource: ResolvedResource,
  cwd: string,
): Promise<void> {
  await syncNewTargetFiles(targetPackage, cwd);

  // For tracked resources, remove the old source keys from the origin package.
  // Re-reads the workspace index because syncNewTargetFiles writes to it.
  if (resource.packageName) {
    try {
      const record = await readWorkspaceIndex(cwd);
      removeWorkspaceIndexFileKeys(record.index, resource.packageName, resource.sourceKeys);
      await writeWorkspaceIndex(record);
    } catch (error) {
      logger.warn(`Failed to clean source index for "${resource.packageName}": ${error}`);
    }
  }
}

/**
 * Detect newly added source files in a target package and install them into
 * the workspace (updating the workspace index).
 *
 * Uses the same sync infrastructure as `sync --pull` but scoped to only new
 * files, avoiding side-effects on existing tracked files.
 */
async function syncNewTargetFiles(
  packageName: string,
  cwd: string,
): Promise<void> {
  try {
    const source = await resolvePackageSource(cwd, packageName);
    const packageRoot = source.absolutePath;

    const { index } = await readWorkspaceIndex(cwd);
    const match = findPackageInIndex(packageName, index.packages ?? {});
    if (!match) {
      logger.debug(`Post-move sync: package "${packageName}" not in workspace index`);
      return;
    }

    const existingKeys = new Set(Object.keys(match.entry.files ?? {}));
    const newFiles = await detectNewSourceFiles(packageRoot, cwd, existingKeys);

    if (newFiles.length > 0) {
      await executePullNewActions(
        newFiles,
        match.key,
        packageRoot,
        cwd,
        { direction: 'pull', dryRun: false },
      );
    }
  } catch (error) {
    logger.warn(`Post-move sync for "${packageName}" failed: ${error}`);
  }
}

/**
 * Resolve a resource directly from a package source directory.
 * Used when --from is specified to go directly to the named package source
 * (e.g., the package exists but isn't installed in any workspace).
 */
async function resolveFromPackageSource(
  resourceInput: string,
  packageName: string,
  execContext: ExecutionContext,
): Promise<ResolvedTarget[]> {
  const query = parseResourceQuery(resourceInput);

  let sourceInfo: { absolutePath: string };
  try {
    sourceInfo = await resolveMutableSource({
      cwd: execContext.sourceCwd,
      packageName,
    });
  } catch {
    return [];
  }

  const scope = isProjectScopedPath(sourceInfo.absolutePath, execContext.sourceCwd)
    ? 'project' : 'global';

  const result = await resolveFromSource(query.name, sourceInfo.absolutePath, scope);
  const typeFilter = query.typeFilter;

  let candidates = result.candidates;
  if (typeFilter) {
    candidates = candidates.filter(
      c => c.kind === 'resource' && c.resource?.resourceType === typeFilter,
    );
  }

  // Disambiguate (0/1/N) so multi-match prompts rather than silently picking [0]
  const out = resolveOutput(execContext);
  const prm = resolvePrompt(execContext);

  const selected = await disambiguate(
    resourceInput,
    candidates,
    (c) => ({
      title: formatCandidateTitle(c),
      description: formatCandidateDescription(c),
      value: c,
    }),
    {
      notFoundMessage: `Resource "${resourceInput}" not found in package "${packageName}".`,
      promptMessage: 'Select which resource to move:',
      multi: false,
    },
    out,
    prm,
  );

  return selected.map(c => ({
    candidate: c.kind === 'resource' && c.resource
      ? { ...c, resource: { ...c.resource, packageName } }
      : c,
    targetDir: execContext.targetDir,
    packageSourcePath: sourceInfo.absolutePath,
  }));
}

