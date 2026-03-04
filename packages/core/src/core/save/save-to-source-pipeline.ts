/**
 * Save To Source Pipeline
 *
 * This module orchestrates the complete save operation, integrating all phases:
 * - Phase 1: Validation
 * - Phase 2: Candidate Discovery & Grouping
 * - Phase 3: Platform Pruning & Filtering
 * - Phase 4: Conflict Analysis & Resolution
 * - Phase 5: File Writes
 * - Phase 6: Result Reporting
 *
 * This is the main entry point for the enhanced save command.
 *
 * @module save-to-source-pipeline
 */

import path from 'path';

import type { CommandResult } from '../../types/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import { assertMutableSourceOrThrow } from '../source-mutability.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { logger } from '../../utils/logger.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { buildCandidates, materializeLocalCandidate } from './save-candidate-builder.js';
import { buildCandidateGroups, filterGroupsWithWorkspace } from './save-group-builder.js';
import { analyzeGroup, type AnalyzeGroupOptions } from './save-conflict-analyzer.js';
import { normalizeSaveOptions } from './save-options-normalizer.js';
import { executeResolution } from './save-resolution-executor.js';
import { pruneExistingPlatformCandidates } from './save-platform-handler.js';
import { writeResolution } from './save-write-coordinator.js';
import { clearConversionCache, initSharedTempDir, cleanupSharedTempDir } from './save-conversion-helper.js';
import {
  buildSaveReport,
  createCommandResult,
  createSuccessResult,
  createErrorResult
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
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  cwd?: string;
  packageRoot?: string;
  filesMapping?: Record<string, (string | WorkspaceIndexFileMapping)[]>;
  error?: string;
}

/**
 * Run the complete save-to-source pipeline
 *
 * This is the main orchestrator function that coordinates all phases
 * of the save operation:
 *
 * 1. **Validate preconditions**: Check package exists, is mutable, has files
 * 2. **Build candidates**: Discover files in workspace and source
 * 3. **Group candidates**: Organize by registry path
 * 4. **Prune platform candidates**: Remove candidates with existing platform files
 * 5. **Filter active groups**: Keep only groups with workspace changes
 * 6. **Analyze & resolve**: Classify conflicts and execute resolution strategies
 * 7. **Write files**: Execute file write operations
 * 8. **Report results**: Build and return comprehensive report
 *
 * @param packageName - Package name to save
 * @param options - Save options (force mode, etc.)
 * @returns CommandResult with success status and report data
 */
export async function runSaveToSourcePipeline(
  packageName: string | undefined,
  options: SaveToSourceOptions = {},
  ctx?: ExecutionContext
): Promise<CommandResult> {
  try {
    await initSharedTempDir();

    // Phase 1: Validate preconditions
    logger.debug(`Validating save preconditions for ${packageName}`);
    const validation = await validateSavePreconditions(packageName);
    if (!validation.valid) {
      return createErrorResult(validation.error!);
    }

    const { cwd, packageRoot, filesMapping } = validation;

    return await executeSavePipeline(packageName!, packageRoot!, cwd!, filesMapping!, options, ctx);
  } finally {
    clearConversionCache();
    await cleanupSharedTempDir();
  }
}

/**
 * Execute the save pipeline (phases 2-8) with pre-validated inputs.
 *
 * This is the internal workhorse called by both `runSaveToSourcePipeline()`
 * (full package save) and `runDirectSaveFlow()` (resource-filtered save).
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
    const statusMap = await checkContentStatus(cwd, packageRoot, filesMapping);
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
        const resolution = await executeResolution(group, analysis, packageRoot, cwd, resolveOutput(ctx), resolvePrompt(ctx));
        if (!resolution) return null;
        return writeResolution(packageRoot, group.registryPath, resolution, group.local, cwd, options.dryRun);
      })
    );
    for (const result of autoResults) {
      if (result) allWriteResults.push(result);
    }
  }

  // Process interactive groups serially (require user input)
  for (const { group, analysis } of interactive) {
    const resolution = await executeResolution(group, analysis, packageRoot, cwd, resolveOutput(ctx), resolvePrompt(ctx));
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
 * Validate save preconditions
 *
 * Performs comprehensive validation before attempting save operation:
 * - Package name is provided
 * - Workspace index exists and is readable
 * - Package exists in index
 * - Package has file mappings
 * - Package source is resolvable
 * - Source is mutable (not registry)
 *
 * @param packageName - Package name to validate
 * @returns Validation result with success status and required data or error
 */
export async function validateSavePreconditions(
  packageName: string | undefined,
  targetDir?: string
): Promise<ValidationResult> {
  const cwd = targetDir ?? process.cwd();

  // Check package name provided
  if (!packageName) {
    return {
      valid: false,
      error: 'Package name is required for save.'
    };
  }

  // Read workspace index
  let index;
  try {
    const result = await readWorkspaceIndex(cwd);
    index = result.index;
  } catch (error) {
    return {
      valid: false,
      error: `Failed to read workspace index: ${error}`
    };
  }

  // Check package exists in index
  const pkgIndex = index.packages?.[packageName];
  if (!pkgIndex) {
    return {
      valid: false,
      error:
        `Package '${packageName}' is not installed in this workspace.\n` +
        `Run 'opkg install ${packageName}' to install it first.`
    };
  }

  // Check package has file mappings
  if (!pkgIndex.files || Object.keys(pkgIndex.files).length === 0) {
    return {
      valid: false,
      error:
        `Package '${packageName}' has no files installed.\n` +
        `Nothing to save.`
    };
  }

  // Resolve package source
  let source;
  try {
    source = await resolvePackageSource(cwd, packageName);
  } catch (error) {
    return {
      valid: false,
      error: `Failed to resolve package source: ${error}`
    };
  }

  // Check source is mutable
  try {
    assertMutableSourceOrThrow(source.absolutePath, {
      packageName: source.packageName,
      command: 'save'
    });
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  return {
    valid: true,
    cwd,
    packageRoot: source.absolutePath,
    filesMapping: pkgIndex.files
  };
}

/**
 * Update workspace index hashes after a successful save.
 *
 * Only updates targets that were active in the save (i.e., in activeFilesMapping).
 * Non-active targets (clean files filtered out by status pre-filter) keep their
 * existing pivot hashes — updating them would make them appear "modified" relative
 * to the new source even though their workspace content hasn't changed.
 *
 * Uses hash(workspace_file) as the pivot rather than computeSourceHash(source),
 * because the workspace file is the ground truth after save (it hasn't changed),
 * and markdown round-trip through the install pipeline can alter frontmatter
 * formatting, producing a hash that doesn't match the workspace.
 */
async function updateWorkspaceHashes(
  cwd: string,
  packageName: string,
  _packageRoot: string,
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
          // Use hash(workspace_file) as pivot — the workspace is the ground
          // truth after save (it hasn't changed). computeSourceHash(source)
          // can produce a different hash for markdown files due to frontmatter
          // re-serialization in the install pipeline round-trip.
          const content = await readTextFile(absTarget);
          const hash = await calculateFileHash(content);

          if (isComplexMapping(mapping)) {
            mapping.hash = hash;
          } else {
            // Upgrade simple string mapping to object form to store hash
            targets[i] = { target: mapping, hash };
          }
          updated = true;
        } catch (error) {
          logger.debug(`Failed to update hash for ${absTarget}: ${error}`);
        }
      }
    }

    if (updated) {
      await writeWorkspaceIndex(record);
      logger.debug(`Updated workspace index hashes for ${packageName}`);
    }
  } catch (error) {
    logger.debug(`Failed to update workspace hashes: ${error}`);
  }
}
