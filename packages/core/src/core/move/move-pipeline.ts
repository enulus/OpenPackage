/**
 * Move Pipeline
 *
 * Core orchestrator for the `opkg move` command. Supports four scenarios:
 * - Rename-only: in-place rename within the same package (source-only)
 * - Relocate-only: move resource from one package to another (source-only)
 * - Rename + Relocate: rename and move in one step (source-only)
 * - Adopt: bring untracked workspace resources into a package via --to
 *
 * All workspace reconciliation is deferred to `sync --pull`.
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
import { readTextFile } from '../../utils/fs.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { validateMoveArgs, validateNotNoop } from './move-validator.js';
import { executeInPlaceRename } from './move-rename-executor.js';
import { disambiguatePlatform, groupFilesByPlatform } from '../platform/platform-disambiguation.js';
import type { SourceEntry } from '../add/source-collector.js';

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
  action: 'rename' | 'relocate' | 'rename-relocate' | 'adopt';
  sourcePath: string;
  sourcePackage?: string;
  resourceName: string;
  newName?: string;
  destPackage?: string;
  renamedFiles?: number;
  movedFiles?: number;
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
    validateMoveArgs(newName, options.to);
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

  // Route untracked resources to adopt flow
  if (!sourcePackage) {
    if (!options.to) {
      return {
        success: false,
        error: `Resource "${resourceInput}" is untracked (not owned by any package).\nUse --to <package> to adopt it into a package.`,
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
        effectiveResource, resourceName, newName, typeDir, options, execContext,
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
      isRename, action, options, execContext,
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
): Promise<CommandResult<MoveResult>> {
  let entries = await buildEntriesFromSourceKeys(packageSourcePath, resource.sourceKeys);

  if (isRename && newName) {
    entries = await renameEntries(entries, resourceName, newName);
  }

  const addResult = await addSourceEntriesToPackage(
    options.to, entries, { force: options.force, execContext },
  );

  if (!addResult.success) {
    return { success: false, error: addResult.error ?? 'Failed to add resource to destination package.' };
  }

  await performMoveCleanup({ resource, packageSourcePath, execContext });

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
  typeDir: string | undefined,
  options: MoveOptions,
  execContext: ExecutionContext,
): Promise<CommandResult<MoveResult>> {
  const effectiveTypeDir = typeDir ?? resource.resourceType + 's';

  let entries = await buildEntriesFromTargetFiles(
    resource.targetFiles, execContext.targetDir, effectiveTypeDir,
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

  await performMoveCleanup({ resource, packageSourcePath: undefined, execContext });

  return {
    success: true,
    data: {
      action: 'adopt',
      sourcePath: execContext.targetDir,
      resourceName,
      newName: isRename ? newName : undefined,
      destPackage: options.to,
      movedFiles: addResult.data?.filesAdded,
      dryRun: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build SourceEntry[] from workspace target files for untracked resources.
 *
 * Derives registry paths by extracting from the typeDir segment onward,
 * deduplicates by registry path (multiple platforms may produce the same one),
 * and reads content from the first workspace file per registry path.
 */
async function buildEntriesFromTargetFiles(
  targetFiles: string[],
  targetDir: string,
  typeDir: string,
): Promise<SourceEntry[]> {
  const seen = new Map<string, SourceEntry>();
  const typeDirPrefix = typeDir + '/';

  for (const targetFile of targetFiles) {
    const idx = targetFile.indexOf(typeDirPrefix);
    if (idx < 0) continue;

    const registryPath = targetFile.slice(idx);
    if (seen.has(registryPath)) continue;

    const absPath = join(targetDir, targetFile);
    let content: string | undefined;
    try {
      content = await readTextFile(absPath);
    } catch {
      // skip unreadable
    }

    seen.set(registryPath, {
      sourcePath: absPath,
      registryPath,
      ...(content !== undefined ? { content } : {}),
    });
  }

  return [...seen.values()];
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

/**
 * Build SourceEntry[] from a set of source keys in a package.
 */
async function buildEntriesFromSourceKeys(
  packageRoot: string,
  sourceKeys: Set<string>,
): Promise<SourceEntry[]> {
  return Promise.all([...sourceKeys].map(async (key) => {
    const absPath = join(packageRoot, key);
    let content: string | undefined;
    try {
      content = await readTextFile(absPath);
    } catch {
      // If read fails, skip content — copyFilesWithConflictResolution handles it
    }
    return {
      sourcePath: absPath,
      registryPath: key,
      ...(content !== undefined ? { content } : {}),
    };
  }));
}
