/**
 * Save To Source Pipeline
 *
 * Core save pipeline used by sync's push executor. Phases:
 * - Status pre-filter (skip clean/outdated)
 * - Candidate Discovery & Grouping
 * - Platform Pruning & Filtering
 * - Conflict Analysis & Resolution
 * - File Writes
 * - Result Reporting
 *
 * @module save-to-source-pipeline
 */

import path from 'path';

import type { CommandResult } from '../../types/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { logger } from '../../utils/logger.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { buildCandidates, materializeLocalCandidate } from './save-candidate-builder.js';
import { buildCandidateGroups, filterGroupsWithWorkspace } from './save-group-builder.js';
import { analyzeGroup, type AnalyzeGroupOptions } from './save-conflict-analyzer.js';
import { normalizeSaveOptions } from './save-options-normalizer.js';
import { executeResolution } from './save-resolution-executor.js';
import { pruneExistingPlatformCandidates } from './save-platform-handler.js';
import { writeResolution } from './save-write-coordinator.js';
import {
  buildSaveReport,
  createCommandResult,
  createSuccessResult,
} from './save-result-reporter.js';
import { checkContentStatus } from '../list/content-status-checker.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { readTextFile, exists } from '../../utils/fs.js';
import { getTargetPath, isComplexMapping } from '../../utils/workspace-index-helpers.js';
import type { ConflictAnalysis } from './save-conflict-analyzer.js';
import type { WriteResult, SaveConflictStrategy, StatusSummary } from './save-types.js';

/**
 * Options for save-to-source pipeline
 */
export interface SaveToSourceOptions {
  /** Preview changes without writing to source */
  dryRun?: boolean;
  /** Conflict resolution strategy */
  conflicts?: SaveConflictStrategy;
  /** Prefer specified platform version for conflicts */
  prefer?: string;
}

/**
 * Execute the save pipeline (phases 2-8) with pre-validated inputs.
 *
 * Called by sync's push executor to perform the actual save operation.
 *
 * @param packageName - Validated package name
 * @param packageRoot - Absolute path to mutable package source
 * @param cwd - Current working directory (workspace root)
 * @param filesMapping - File mappings from workspace index (possibly filtered)
 * @param options - Save options (force mode, etc.)
 * @param ctx - Optional execution context
 * @returns CommandResult with success status and report data
 */
export async function executeSavePipeline(
  packageName: string,
  packageRoot: string,
  cwd: string,
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  options: SaveToSourceOptions = {},
  ctx?: ExecutionContext
): Promise<CommandResult> {
  // Phase 1.5: Status pre-filter — skip clean and outdated files
  let statusSummary: StatusSummary = { cleanFileCount: 0, outdatedFiles: [], divergedFiles: [] };
  let activeFilesMapping = filesMapping;

  try {
    const { statusMap } = await checkContentStatus(cwd, packageRoot, filesMapping);
    statusSummary.statusMap = statusMap;

    const filteredMapping: Record<string, (string | WorkspaceIndexFileMapping)[]> = {};
    for (const [sourceKey, targets] of Object.entries(filesMapping)) {
      if (!Array.isArray(targets)) continue;

      const kept: (string | WorkspaceIndexFileMapping)[] = [];
      for (const mapping of targets) {
        const targetPath = getTargetPath(mapping);
        const key = `${sourceKey}::${targetPath}`;
        const status = statusMap.get(key);

        if (status === 'clean') {
          // Only skip if source actually exists — 'clean' with missing source
          // means a new workspace file (status checker falls through to 'clean')
          const absSource = path.join(packageRoot, sourceKey);
          if (await exists(absSource)) {
            statusSummary.cleanFileCount++;
            continue; // Skip truly clean files
          }
        }
        if (status === 'outdated') {
          statusSummary.outdatedFiles.push(targetPath);
          continue; // Skip outdated files (source newer, warn later)
        }
        if (status === 'source-deleted') {
          continue; // Cannot push to deleted source
        }
        if (status === 'diverged') {
          statusSummary.divergedFiles.push(targetPath);
        }
        // modified, diverged, merged, or no-status → keep
        kept.push(mapping);
      }

      if (kept.length > 0) {
        filteredMapping[sourceKey] = kept;
      }
    }

    activeFilesMapping = filteredMapping;

    if (Object.keys(activeFilesMapping).length === 0) {
      const parts = [`Saved ${packageName}\n  No workspace changes detected`];
      if (statusSummary.cleanFileCount > 0) {
        parts.push(`  ${statusSummary.cleanFileCount} file(s) already clean`);
      }
      if (statusSummary.outdatedFiles.length > 0) {
        parts.push(`  ${statusSummary.outdatedFiles.length} file(s) outdated (source updated since install)`);
        parts.push(`  Run 'opkg install ${packageName}' to sync latest source changes`);
      }
      return createSuccessResult(packageName, parts.join('\n'));
    }

    logger.debug(
      `Status pre-filter: ${statusSummary.cleanFileCount} clean, ` +
      `${statusSummary.outdatedFiles.length} outdated, ` +
      `${statusSummary.divergedFiles.length} diverged, ` +
      `${Object.keys(activeFilesMapping).length} active source keys remaining`
    );
  } catch (error) {
    // Status check is non-fatal — proceed with full filesMapping
    logger.debug(`Status pre-filter failed (proceeding with all files): ${error}`);
  }

  // Phase 2: Build candidates from workspace and source
  logger.debug(`Building candidates for ${packageName}`);
  const candidateResult = await buildCandidates({
    packageRoot,
    workspaceRoot: cwd,
    filesMapping: activeFilesMapping
  });

  if (candidateResult.errors.length > 0) {
    logger.warn(`Encountered ${candidateResult.errors.length} error(s) building candidates`);
    candidateResult.errors.forEach(err =>
      logger.warn(`  ${err.path}: ${err.reason}`)
    );
  }

  // Phase 3: Build candidate groups (organize by registry path)
  logger.debug('Building candidate groups');
  const allGroups = buildCandidateGroups(
    candidateResult.localSourceRefs,
    candidateResult.workspaceCandidates,
    cwd
  );

  // Phase 4: Filter first (cheap), then prune only active groups
  const activeGroups = filterGroupsWithWorkspace(allGroups);

  if (activeGroups.length === 0) {
    logger.info(`No workspace changes detected for ${packageName}`);
    return createSuccessResult(
      packageName,
      `Saved ${packageName}\n  No workspace changes detected`
    );
  }

  // Prune only active groups (instead of all groups)
  logger.debug('Pruning existing platform-specific files');
  await pruneExistingPlatformCandidates(packageRoot, activeGroups);

  // Re-filter after pruning (pruning may have removed all workspace candidates from some groups)
  const finalGroups = activeGroups.filter(g => g.workspace.length > 0);

  if (finalGroups.length === 0) {
    logger.info(`No workspace changes detected for ${packageName}`);
    return createSuccessResult(
      packageName,
      `Saved ${packageName}\n  No workspace changes detected`
    );
  }

  // Phase 5: Materialize local candidates on demand for active groups
  for (const group of finalGroups) {
    if (group.localRef && !group.local) {
      group.local = await materializeLocalCandidate(group.localRef, packageRoot) ?? undefined;
    }
  }

  logger.debug(`Processing ${finalGroups.length} group(s) with workspace candidates`);

  // Normalize options (resolve --force alias, validate --conflicts)
  const normalized = normalizeSaveOptions(options);
  const analyzeOpts: AnalyzeGroupOptions = {
    conflictStrategy: normalized.conflicts,
    preferPlatform: normalized.prefer,
    statusMap: statusSummary.statusMap,
  };

  // Phase 6: Analyze all groups first, then split into auto-resolvable vs interactive
  const groupAnalyses = await Promise.all(
    finalGroups.map(async group => ({
      group,
      analysis: await analyzeGroup(group, analyzeOpts, cwd)
    }))
  );

  const analyses: ConflictAnalysis[] = groupAnalyses.map(ga => ga.analysis);
  const allWriteResults: WriteResult[][] = [];

  // Partition: auto-resolvable groups can run in parallel, interactive must be serial
  const autoResolvable: typeof groupAnalyses = [];
  const interactive: typeof groupAnalyses = [];

  for (const ga of groupAnalyses) {
    if (ga.analysis.type === 'no-action-needed' || ga.analysis.type === 'no-change-needed') {
      logger.debug(`Skipping ${ga.group.registryPath}: ${ga.analysis.type}`);
      continue;
    }
    if (ga.analysis.recommendedStrategy === 'interactive') {
      interactive.push(ga);
    } else {
      autoResolvable.push(ga);
    }
  }

  // Process auto-resolvable groups in parallel
  if (autoResolvable.length > 0) {
    logger.debug(`Processing ${autoResolvable.length} auto-resolvable group(s) in parallel`);
    const autoResults = await Promise.all(
      autoResolvable.map(async ({ group, analysis }) => {
        const resolution = await executeResolution(group, analysis, packageRoot, cwd, resolvePrompt(ctx));
        if (!resolution) return null;
        return writeResolution(packageRoot, group.registryPath, resolution, group.local, cwd, options.dryRun);
      })
    );
    for (const result of autoResults) {
      if (result) allWriteResults.push(result);
    }
  }

  // Process interactive groups serially (require user input)
  if (interactive.length > 0) {
    const out = resolveOutput(ctx);
    out.warn(`${interactive.length} conflict(s) to resolve\n`);
  }

  for (const { group, analysis } of interactive) {
    const resolution = await executeResolution(group, analysis, packageRoot, cwd, resolvePrompt(ctx));
    if (!resolution) {
      logger.debug(`No resolution returned for ${group.registryPath}`);
      continue;
    }
    const writeResults = await writeResolution(
      packageRoot, group.registryPath, resolution, group.local, cwd, options.dryRun
    );
    allWriteResults.push(writeResults);
  }

  // Phase 7: Update workspace index hashes so three-way pivot resets after save
  // Only update targets that were in the active mapping (not filtered-out clean/outdated ones).
  // Updating all targets would break the pivot for non-modified workspace files.
  if (!options.dryRun) {
    await updateWorkspaceHashes(cwd, packageName, packageRoot, activeFilesMapping, allWriteResults);
  }

  // Phase 8: Build and format report
  logger.debug('Building save report');
  const report = buildSaveReport(packageName, analyses, allWriteResults, options.dryRun, statusSummary);

  // Phase 9: Return result
  return createCommandResult(report);
}

/**
 * Update workspace index hashes after a successful save.
 *
 * Stores dual hashes per file mapping:
 * - `hash`: xxhash3 of the workspace file (workspace-side pivot)
 * - `sourceHash`: xxhash3 of the raw source file after save (source-side pivot)
 *
 * Only updates targets that were active in the save (i.e., in activeFilesMapping).
 * Non-active targets (clean files filtered out by status pre-filter) keep their
 * existing pivot hashes.
 */
async function updateWorkspaceHashes(
  cwd: string,
  packageName: string,
  packageRoot: string,
  activeFilesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  allWriteResults: WriteResult[][]
): Promise<void> {
  try {
    // Collect registry paths of successfully processed files (including skips).
    // A 'skip' means the source already has the correct content (from a prior save),
    // but the workspace pivot hash may still be stale and needs updating.
    const writtenPaths = new Set<string>();
    for (const results of allWriteResults) {
      for (const wr of results) {
        if (wr.success) {
          writtenPaths.add(wr.operation.registryPath);
        }
      }
    }

    if (writtenPaths.size === 0) return;

    // Build set of target paths that were active in this save.
    // Only these targets should have their pivot hashes updated.
    const activeTargets = new Set<string>();
    for (const targets of Object.values(activeFilesMapping)) {
      if (!Array.isArray(targets)) continue;
      for (const mapping of targets) {
        activeTargets.add(getTargetPath(mapping));
      }
    }

    const record = await readWorkspaceIndex(cwd);
    const pkg = record.index.packages?.[packageName];
    if (!pkg?.files) return;

    let updated = false;
    for (const [sourceKey, targets] of Object.entries(pkg.files)) {
      if (!Array.isArray(targets)) continue;

      // Check if this source key was part of a successful write
      if (!writtenPaths.has(sourceKey)) continue;

      for (let i = 0; i < targets.length; i++) {
        const mapping = targets[i];
        const targetPath = getTargetPath(mapping);

        // Only update targets that were active in the save
        if (!activeTargets.has(targetPath)) continue;

        const absTarget = path.join(cwd, targetPath);
        if (!(await exists(absTarget))) continue;

        try {
          const content = await readTextFile(absTarget);
          const hash = await calculateFileHash(content);

          // Compute source hash from raw source file after save
          const absSource = path.join(packageRoot, sourceKey);
          let sourceHashValue: string | undefined;
          if (await exists(absSource)) {
            const sourceContent = await readTextFile(absSource);
            sourceHashValue = await calculateFileHash(sourceContent);
          }

          if (isComplexMapping(mapping)) {
            mapping.hash = hash;
            if (sourceHashValue) mapping.sourceHash = sourceHashValue;
          } else {
            // Upgrade simple string mapping to object form to store hashes
            const upgraded: WorkspaceIndexFileMapping = { target: mapping as string, hash };
            if (sourceHashValue) upgraded.sourceHash = sourceHashValue;
            targets[i] = upgraded;
          }
          updated = true;
        } catch (error) {
          logger.warn(`Failed to update hash for ${absTarget}: ${error}`);
        }
      }
    }

    if (updated) {
      await writeWorkspaceIndex(record);
      logger.debug(`Updated workspace index hashes for ${packageName}`);
    }
  } catch (error) {
    logger.warn(`Failed to update workspace hashes: ${error}`);
  }
}
