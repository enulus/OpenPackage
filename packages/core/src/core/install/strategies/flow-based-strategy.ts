/**
 * Standard Flow-Based Installation Strategy
 * 
 * Applies platform flows with full transformations.
 * Used for universal format packages.
 */

import { join, relative, dirname, basename, extname } from 'path';
import type { Platform } from '../../platforms.js';
import type { PackageFormat } from '../format-detector.js';
import type { InstallOptions } from '../../../types/index.js';
import type { FlowInstallContext, FlowInstallResult } from './types.js';
import type { Flow, FlowContext } from '../../../types/flows.js';
import { BaseStrategy } from './base-strategy.js';
import { platformUsesFlows } from '../../platforms.js';
import { convertToInstallResult } from './helpers/result-converter.js';
import {
  resolveTargetFromGlob,
} from '../../flows/flow-execution-coordinator.js';
import { isPassThroughFlow } from '../../flows/flow-executor.js';
import {
  resolvePattern,
  extractCapturedName,
  getFirstFromPattern,
} from '../../flows/flow-source-discovery.js';
import { resolveSwitchExpression, isSwitchExpression } from '../../flows/switch-resolver.js';
import {
  buildImportFlowContext,
  discoverAndFilterSources,
  executeImportFlows,
  type ImportPipelineContext,
} from '../../flows/import-pipeline.js';
import {
  buildOwnershipContext,
  resolveConflictsForTargets,
  type TargetEntry,
} from '../conflicts/file-conflict-resolver.js';
import { normalizePathForProcessing } from '../../../utils/path-normalization.js';
import { readTextFile } from '../../../utils/fs.js';
import { MARKDOWN_EXTENSIONS } from '../../../constants/index.js';
import { mergeInlinePlatformOverride } from '../../platform-yaml-merge.js';
import { logger } from '../../../utils/logger.js';
import { readWorkspaceIndex } from '../../../utils/workspace-index-yml.js';

interface ComputedTargets {
  entries: TargetEntry[];
  sourceMap: Array<{ flow: Flow; sourceRel: string }>;
}

/**
 * Standard Flow-Based Installation Strategy
 *
 * Applies platform flows with full transformations.
 * Used for universal format packages.
 */
export class FlowBasedInstallStrategy extends BaseStrategy {
  readonly name = 'flow-based';
  
  canHandle(format: PackageFormat, platform: Platform): boolean {
    // Default strategy - handles all remaining cases
    return true;
  }
  
  async install(
    context: FlowInstallContext,
    options?: InstallOptions,
    forceOverwrite: boolean = false
  ): Promise<FlowInstallResult> {
    const { packageName, packageRoot, workspaceRoot, platform, dryRun } = context;

    this.logStrategySelection(context);

    // Check if platform uses flows
    if (!platformUsesFlows(platform, workspaceRoot)) {
      return this.createEmptyResult();
    }

    // Get applicable flows
    const flows = this.getApplicableFlows(platform, workspaceRoot);
    if (flows.length === 0) {
      return this.createEmptyResult();
    }

    // Build shared pipeline context (used for both FlowContext and discovery)
    const pipelineCtx: ImportPipelineContext = {
      packageName, packageRoot, workspaceRoot, platform,
      packageVersion: context.packageVersion,
      priority: context.priority,
      dryRun: context.dryRun,
      conversionContext: context.conversionContext,
      matchedPattern: context.matchedPattern,
    };
    const flowContext = buildImportFlowContext(pipelineCtx, 'install');

    // Use shared pipeline stages for discovery + filtering
    const filteredSources = await discoverAndFilterSources(
      flows, pipelineCtx, flowContext,
    );

    // -----------------------------------------------------------------------
    // File-level conflict resolution (Phase 3)
    // -----------------------------------------------------------------------
    const effectiveOptions = options ?? {};
    const conflictWarnings: string[] = [];
    let wasNamespaced = false;
    let conflictRelocatedFiles: Array<{ from: string; to: string }> = [];

    try {
      // Pre-compute the target paths that will be written by the flows
      const computed = this.computeTargetEntries(filteredSources, flowContext);
      const targets = computed.entries;

      if (targets.length > 0) {
        // Use shared ownership context (parallel mode) or build fresh (sequential mode)
        let ownershipContext;
        if (context.sharedOwnershipContext) {
          ownershipContext = context.sharedOwnershipContext;
        } else {
          // Use pre-read record when available to avoid redundant disk reads
          const wsRecord = context.previousIndexRecord;
          const previousRecord = wsRecord
            ? this.extractPreviousRecord(wsRecord, packageName)
            : await this.readPreviousIndexRecord(workspaceRoot, packageName);

          // Build ownership context (other-package indexes + previous-owned paths)
          ownershipContext = await buildOwnershipContext(
            workspaceRoot,
            packageName,
            previousRecord,
            wsRecord
          );
        }

        // Extract persisted namespace from pre-read record to avoid a redundant readWorkspaceIndex
        const persistedNamespace = context.previousIndexRecord
          ?.index.packages?.[packageName]?.namespace;

        // Resolve conflicts — get back the filtered set of allowed targets
        const { allowedTargets, warnings, packageWasNamespaced, namespaceDir, relocatedFiles, claimedFiles } = await resolveConflictsForTargets(
          workspaceRoot,
          targets,
          ownershipContext,
          effectiveOptions,
          packageName,
          forceOverwrite,
          context.prompt,
          undefined,
          context.indexWriteCollector,
          persistedNamespace
        );
        conflictWarnings.push(...warnings);
        wasNamespaced = packageWasNamespaced;
        conflictRelocatedFiles = relocatedFiles;

        // Build target path remap and allowed original paths in a single pass.
        // Index allowedTargets by composite key for O(1) lookup.
        const allowedByKey = new Map<string, TargetEntry>();
        for (const at of allowedTargets) {
          allowedByKey.set(`${at.sourceAbsPath}\0${at.flowToPattern}`, at);
        }

        const targetPathRemap = new Map<string, string>();
        const allowedOriginalPaths = new Set<string>();
        for (const t of targets) {
          const key = `${t.sourceAbsPath}\0${t.flowToPattern}`;
          const match = allowedByKey.get(key);
          if (!match) continue;

          const origNorm = normalizePathForProcessing(t.relPath);
          allowedOriginalPaths.add(origNorm);

          if (packageWasNamespaced) {
            const newNorm = normalizePathForProcessing(match.relPath);
            if (origNorm !== newNorm) {
              targetPathRemap.set(origNorm, newNorm);
            }
          }
        }
        const prunedSources = this.buildPrunedSources(computed, allowedOriginalPaths);

        // Pass remap into flow execution context
        const execFlowContext: FlowContext = targetPathRemap.size > 0
          ? { ...flowContext, targetPathRemap }
          : flowContext;

        // Execute flows on the pruned source set (shared pipeline stage)
        const executionResult = await executeImportFlows(prunedSources, execFlowContext);
        const result = convertToInstallResult(executionResult, packageName, platform, dryRun);

        // Surface conflict warnings as additional FlowConflictReport entries
        for (const msg of conflictWarnings) {
          logger.warn(msg);
          result.conflicts.push({
            targetPath: '',
            packages: [{ packageName, priority: 0, chosen: true }],
            message: msg
          });
        }

        // Attach namespace metadata to the result
        result.namespaced = wasNamespaced;
        result.namespaceSlug = namespaceDir;
        result.relocatedFiles = conflictRelocatedFiles;
        result.claimedFiles = claimedFiles;

        this.logResults(result, context);
        return result;
      }
    } catch (error) {
      // Conflict resolution is best-effort: on unexpected failure log and continue
      logger.warn(`File conflict resolution failed for ${packageName}: ${error}. Proceeding without conflict checks.`);
    }

    // Execute flows (no targets to conflict-check, or conflict resolution errored)
    const executionResult = await executeImportFlows(filteredSources, flowContext);
    
    // Convert to result
    const result = convertToInstallResult(executionResult, packageName, platform, dryRun);
    
    this.logResults(result, context);
    
    return result;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Pre-compute the workspace-relative target path for each (flow, source) pair
   * using the same resolution logic as the flow execution coordinator.
   * Each entry is annotated with the resolved `to` pattern and merge-flow flag
   * so that the conflict resolver can derive namespace insertion points and
   * correctly exclude merge flows from namespacing.
   */
  private computeTargetEntries(
    flowSources: Map<Flow, string[]>,
    flowContext: FlowContext
  ): ComputedTargets {
    const entries: TargetEntry[] = [];
    const sourceMap: Array<{ flow: Flow; sourceRel: string }> = [];

    for (const [flow, sources] of flowSources) {
      const firstPattern = getFirstFromPattern(flow.from);
      // A flow is a merge flow when its merge strategy is not plain 'replace'
      // (deep, shallow, and composite all produce merged/combined output)
      const isMergeFlow = Boolean(
        flow.merge && flow.merge !== 'replace'
      );

      for (const sourceRel of sources) {
        try {
          const sourceAbs = join(flowContext.packageRoot, sourceRel);
          const capturedName = extractCapturedName(sourceRel, firstPattern);

          const sourceContext: FlowContext = {
            ...flowContext,
            variables: {
              ...flowContext.variables,
              sourcePath: sourceRel,
              sourceDir: dirname(sourceRel),
              sourceFile: basename(sourceRel),
              ...(capturedName ? { capturedName } : {})
            }
          };

          let rawToPattern: string;
          if (typeof flow.to === 'string') {
            rawToPattern = flow.to;
          } else if (isSwitchExpression(flow.to)) {
            rawToPattern = resolveSwitchExpression(flow.to, sourceContext);
          } else if (typeof flow.to === 'object' && flow.to !== null && 'pattern' in flow.to) {
            rawToPattern = (flow.to as { pattern: string }).pattern;
          } else {
            rawToPattern = Object.keys(flow.to as object)[0] ?? '';
          }

          const resolvedToPattern = resolvePattern(rawToPattern, sourceContext, capturedName);
          const targetAbs = resolveTargetFromGlob(
            sourceAbs,
            firstPattern,
            resolvedToPattern,
            sourceContext
          );

          const targetRelRaw = relative(flowContext.workspaceRoot, targetAbs);
          const targetRel = normalizePathForProcessing(targetRelRaw);

          // Always provide sourceAbsPath for non-merge flows so the conflict
          // resolver can fall back to a raw-source comparison when needed.
          const provideSourcePath = !isMergeFlow;

          // For non-pass-through markdown flows during a platform install the
          // executor will apply mergeInlinePlatformOverride().  Build a lazy
          // callback so the conflict resolver can compare the *transformed*
          // output (not just the raw source) against what's already on disk.
          let resolveOutputContent: (() => Promise<string>) | undefined;
          if (
            provideSourcePath
            && !isPassThroughFlow(flow, sourceAbs, targetAbs, flowContext)
            && MARKDOWN_EXTENSIONS.has(extname(sourceAbs).toLowerCase())
            && flowContext.platform
            && flowContext.direction === 'install'
          ) {
            const capturedSourceAbs = sourceAbs;
            const capturedPlatform = flowContext.platform;
            const capturedWorkspaceRoot = flowContext.workspaceRoot;
            resolveOutputContent = async () => {
              const raw = await readTextFile(capturedSourceAbs, 'utf8');
              return mergeInlinePlatformOverride(raw, capturedPlatform, capturedWorkspaceRoot);
            };
          }

          entries.push({
            relPath: targetRel,
            absPath: targetAbs,
            flowToPattern: resolvedToPattern,
            isMergeFlow,
            sourceAbsPath: provideSourcePath ? sourceAbs : undefined,
            resolveOutputContent,
          });
          sourceMap.push({ flow, sourceRel });
        } catch {
          // If target resolution fails for a source, skip it — the executor
          // will handle the error properly during execution.
        }
      }
    }

    return { entries, sourceMap };
  }

  /**
   * Build a pruned flow→sources map by checking each pre-computed target entry
   * against the set of allowed original paths. Merge-flow entries are always kept.
   */
  private buildPrunedSources(
    computed: ComputedTargets,
    allowedOriginalPaths: Set<string>
  ): Map<Flow, string[]> {
    const pruned = new Map<Flow, string[]>();
    for (let i = 0; i < computed.entries.length; i++) {
      const entry = computed.entries[i];
      const { flow, sourceRel } = computed.sourceMap[i];
      if (entry.isMergeFlow || allowedOriginalPaths.has(normalizePathForProcessing(entry.relPath))) {
        if (!pruned.has(flow)) pruned.set(flow, []);
        pruned.get(flow)!.push(sourceRel);
      }
    }
    return pruned;
  }

  /**
   * Extract the previous index record from a pre-read workspace index (no I/O).
   */
  private extractPreviousRecord(
    wsRecord: import('../../../utils/workspace-index-yml.js').WorkspaceIndexRecord,
    packageName: string
  ): { files: Record<string, any[]> } | null {
    const entry = wsRecord.index.packages?.[packageName];
    if (!entry) return null;
    return { files: entry.files ?? {} };
  }

  /**
   * Read the package's existing workspace-index entry (its files mapping),
   * used to determine which paths were previously owned by this package.
   * Fallback for when no pre-read record is available.
   */
  private async readPreviousIndexRecord(
    cwd: string,
    packageName: string
  ): Promise<{ files: Record<string, any[]> } | null> {
    try {
      const wsRecord = await readWorkspaceIndex(cwd);
      const entry = wsRecord.index.packages?.[packageName];
      if (!entry) return null;
      return { files: entry.files ?? {} };
    } catch {
      return null;
    }
  }
}

