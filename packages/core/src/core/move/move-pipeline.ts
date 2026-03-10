/**
 * Move Pipeline
 *
 * Core orchestrator for the `opkg move` command. Supports three scenarios:
 * - Rename-only: in-place rename within the same package
 * - Relocate-only: move resource from one package to another
 * - Rename + Relocate: rename and move in one step
 */

import { join } from 'path';

import type { CommandResult } from '../../types/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import { classifyResourceSpec, resolveResourceSpec, type ResolvedTarget } from '../resources/resource-spec.js';
import { parseResourceQuery } from '../resources/resource-query.js';
import { addSourceEntriesToPackage } from '../add/add-to-source-pipeline.js';
import { performMoveCleanup } from '../add/move-cleanup.js';
import { renameEntries } from '../add/entry-renamer.js';
import { readTextFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { validateMoveArgs, validateNotNoop } from './move-validator.js';
import { executeInPlaceRename } from './move-rename-executor.js';
import { updateIndexForRename } from './move-index-updater.js';
import { runSyncPipeline } from '../sync/sync-pipeline.js';
import type { SourceEntry } from '../add/source-collector.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MoveOptions {
  to?: string;
  from?: string;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface MoveResult {
  action: 'rename' | 'relocate' | 'rename-relocate';
  sourcePath: string;
  sourcePackage: string;
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

  // 2. Classify and resolve the resource spec
  const classification = classifyResourceSpec(resourceInput);

  if (classification.kind !== 'resource-ref') {
    return {
      success: false,
      error:
        `"${resourceInput}" does not look like a resource reference.\n` +
        'Expected format: <type>/<name> (e.g., agents/my-agent, skills/my-skill)',
    };
  }

  const traverseOpts = { programOpts: { cwd: execContext.sourceCwd } };

  let resolved: ResolvedTarget[];
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

  if (!sourcePackage) {
    return {
      success: false,
      error: `Resource "${resourceInput}" is untracked (not owned by any package). Cannot move untracked resources.`,
    };
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
        typeDir, sourcePackage, cwd, execContext,
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
  typeDir: string | undefined,
  sourcePackage: string,
  cwd: string,
  execContext: ExecutionContext,
): Promise<CommandResult<MoveResult>> {
  const renameResult = await executeInPlaceRename(
    packageSourcePath, sourceKeys, resourceName, newName,
  );

  const effectiveTypeDir = typeDir ?? [...sourceKeys][0]?.split('/')[0] ?? '';

  await updateIndexForRename(cwd, sourcePackage, resourceName, newName, effectiveTypeDir);

  // Re-deploy via sync pull
  try {
    await runSyncPipeline(sourcePackage, cwd, { direction: 'pull', dryRun: false }, execContext);
  } catch (syncErr) {
    logger.debug('Post-rename sync failed (non-fatal)', { error: syncErr });
  }

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
  resource: { resourceName: string; packageName?: string; sourceKeys: Set<string>; [k: string]: any },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
