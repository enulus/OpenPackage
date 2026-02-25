/**
 * Standard Flow-Based Installation Strategy
 * 
 * Applies platform flows with full transformations.
 * Used for universal format packages.
 */

import { join, relative, dirname, basename } from 'path';
import type { Platform } from '../../platforms.js';
import type { PackageFormat } from '../format-detector.js';
import type { InstallOptions } from '../../../types/index.js';
import type { FlowInstallContext, FlowInstallResult } from './types.js';
import type { Flow, FlowContext, SwitchExpression } from '../../../types/flows.js';
import { BaseStrategy } from './base-strategy.js';
import { platformUsesFlows } from '../../platforms.js';
import { filterSourcesByPlatform } from './helpers/platform-filtering.js';
import { convertToInstallResult } from './helpers/result-converter.js';
import { discoverFlowSources } from '../../flows/flow-source-discovery.js';
import { executeFlowsForSources } from '../../flows/flow-execution-coordinator.js';
import {
  resolveTargetFromGlob,
} from '../../flows/flow-execution-coordinator.js';
import {
  resolvePattern,
  extractCapturedName,
  getFirstFromPattern,
} from '../../flows/flow-source-discovery.js';
import { resolveSwitchExpression } from '../../flows/switch-resolver.js';
import {
  buildOwnershipContext,
  resolveConflictsForTargets,
  namespaceFlowToPattern,
  type TargetEntry,
} from '../conflicts/file-conflict-resolver.js';
import { normalizePathForProcessing } from '../../../utils/path-normalization.js';
import { logger } from '../../../utils/logger.js';
import { readWorkspaceIndex } from '../../../utils/workspace-index-yml.js';

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
    
    // Build context
    const flowContext = this.buildFlowContext(context, 'install');
    
    // Discover sources
    const flowSources = await discoverFlowSources(flows, packageRoot, flowContext);

    // Apply resource filtering if specified
    const resourceFilteredSources = this.applyResourceFiltering(
      flowSources,
      context.matchedPattern,
      packageRoot
    );
    
    // Filter by platform
    const filteredSources = filterSourcesByPlatform(resourceFilteredSources, platform);

    // -----------------------------------------------------------------------
    // File-level conflict resolution (Phase 3)
    // -----------------------------------------------------------------------
    const effectiveOptions = options ?? {};
    const conflictWarnings: string[] = [];
    let wasNamespaced = false;
    let conflictRelocatedFiles: Array<{ from: string; to: string }> = [];

    try {
      // Pre-compute the target paths that will be written by the flows
      const targets = this.computeTargetEntries(filteredSources, flowContext);

      if (targets.length > 0) {
        // Use shared ownership context (parallel mode) or build fresh (sequential mode)
        let ownershipContext;
        if (context.sharedOwnershipContext) {
          ownershipContext = context.sharedOwnershipContext;
        } else {
          // Load the package's previous workspace-index record to determine previously-owned paths
          const previousRecord = await this.readPreviousIndexRecord(workspaceRoot, packageName);

          // Build ownership context (other-package indexes + previous-owned paths)
          ownershipContext = await buildOwnershipContext(
            workspaceRoot,
            packageName,
            previousRecord
          );
        }

        // Resolve conflicts — get back the filtered set of allowed targets
        const { allowedTargets, warnings, packageWasNamespaced, namespaceDir, relocatedFiles } = await resolveConflictsForTargets(
          workspaceRoot,
          targets,
          ownershipContext,
          effectiveOptions,
          packageName,
          forceOverwrite,
          context.prompt,
          undefined,
          context.indexWriteCollector
        );
        conflictWarnings.push(...warnings);
        wasNamespaced = packageWasNamespaced;
        conflictRelocatedFiles = relocatedFiles;

        // When bulk namespacing was triggered, rewrite every non-merge flow's
        // `to` pattern so the executor writes files to namespaced locations.
        const sourcesToExecute = packageWasNamespaced && namespaceDir
          ? this.rewriteFlowsForNamespace(filteredSources, namespaceDir)
          : filteredSources;

        // Rebuild filteredSources keeping only flows whose targets were allowed.
        // Normalize paths to ensure consistent comparison (conflict resolver uses normalizePathForProcessing).
        const allowedRelPaths = new Set(
          allowedTargets.map(t => normalizePathForProcessing(t.relPath))
        );
        const prunedSources = this.pruneSourcesByAllowedTargets(
          sourcesToExecute,
          flowContext,
          allowedRelPaths
        );

        // Execute flows on the pruned source set
        const executionResult = await executeFlowsForSources(prunedSources, flowContext);
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
        result.relocatedFiles = conflictRelocatedFiles;

        this.logResults(result, context);
        return result;
      }
    } catch (error) {
      // Conflict resolution is best-effort: on unexpected failure log and continue
      logger.warn(`File conflict resolution failed for ${packageName}: ${error}. Proceeding without conflict checks.`);
    }

    // Execute flows (no targets to conflict-check, or conflict resolution errored)
    const executionResult = await executeFlowsForSources(filteredSources, flowContext);
    
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
  ): TargetEntry[] {
    const entries: TargetEntry[] = [];

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
            rawToPattern = resolveSwitchExpression(flow.to as SwitchExpression, sourceContext);
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
          const targetRel = targetRelRaw.replace(/\\/g, '/');

          entries.push({
            relPath: targetRel,
            absPath: targetAbs,
            flowToPattern: resolvedToPattern,
            isMergeFlow
          });
        } catch {
          // If target resolution fails for a source, skip it — the executor
          // will handle the error properly during execution.
        }
      }
    }

    return entries;
  }

  /**
   * Rewrite the `to` pattern of every non-merge flow to include the namespace
   * subdirectory.  Returns a new Map — the original is not mutated.
   *
   * Merge flows (deep / shallow / composite) are left untouched because they
   * produce a single combined output file that is intentionally shared across
   * packages.
   */
  private rewriteFlowsForNamespace(
    flowSources: Map<Flow, string[]>,
    namespaceDir: string
  ): Map<Flow, string[]> {
    const rewritten = new Map<Flow, string[]>();

    for (const [flow, sources] of flowSources) {
      const isMerge = Boolean(flow.merge && flow.merge !== 'replace');
      if (isMerge) {
        // Keep merge flows exactly as-is
        rewritten.set(flow, sources);
        continue;
      }

      // Rewrite the `to` field to include the namespace
      let newTo: Flow['to'];
      if (typeof flow.to === 'string') {
        newTo = namespaceFlowToPattern(flow.to, namespaceDir);
      } else if (
        typeof flow.to === 'object' &&
        flow.to !== null &&
        '$switch' in flow.to
      ) {
        // SwitchExpression — rewrite each case value and the default
        const sw = flow.to as any;
        const rewriteSwitchValue = (v: any): any => {
          if (typeof v === 'string') return namespaceFlowToPattern(v, namespaceDir);
          if (typeof v === 'object' && v !== null && 'pattern' in v) {
            return { ...v, pattern: namespaceFlowToPattern(v.pattern, namespaceDir) };
          }
          return v;
        };
        newTo = {
          $switch: {
            ...sw.$switch,
            cases: sw.$switch.cases.map((c: any) => ({
              ...c,
              value: rewriteSwitchValue(c.value)
            })),
            ...(sw.$switch.default !== undefined
              ? { default: rewriteSwitchValue(sw.$switch.default) }
              : {})
          }
        } as unknown as Flow['to'];
      } else if (
        typeof flow.to === 'object' &&
        flow.to !== null &&
        'pattern' in flow.to
      ) {
        newTo = { pattern: namespaceFlowToPattern((flow.to as any).pattern, namespaceDir) } as Flow['to'];
      } else if (typeof flow.to === 'object' && flow.to !== null) {
        // MultiTargetFlows — rewrite each key
        const multi: Record<string, any> = {};
        for (const [key, val] of Object.entries(flow.to as object)) {
          multi[namespaceFlowToPattern(key, namespaceDir)] = val;
        }
        newTo = multi as Flow['to'];
      } else {
        newTo = flow.to;
      }

      rewritten.set({ ...flow, to: newTo }, sources);
    }

    return rewritten;
  }

  /**
   * Remove from filteredSources any (flow, source) pair whose resolved target
   * was not in the allowedRelPaths set.
   */
  private pruneSourcesByAllowedTargets(
    flowSources: Map<Flow, string[]>,
    flowContext: FlowContext,
    allowedRelPaths: Set<string>
  ): Map<Flow, string[]> {
    const pruned = new Map<Flow, string[]>();

    for (const [flow, sources] of flowSources) {
      const firstPattern = getFirstFromPattern(flow.from);
      const keptSources: string[] = [];

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
            rawToPattern = resolveSwitchExpression(flow.to as SwitchExpression, sourceContext);
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

          if (allowedRelPaths.has(targetRel)) {
            keptSources.push(sourceRel);
          }
        } catch {
          // On resolution failure, keep the source so the executor handles it
          keptSources.push(sourceRel);
        }
      }

      if (keptSources.length > 0) {
        pruned.set(flow, keptSources);
      }
    }

    return pruned;
  }

  /**
   * Read the package's existing workspace-index entry (its files mapping),
   * used to determine which paths were previously owned by this package.
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

// -------------------------------------------------------------------------
// Module-private helper (mirrors isSwitchExpression in flow-execution-coordinator)
// -------------------------------------------------------------------------
function isSwitchExpression(value: unknown): value is SwitchExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$switch' in (value as object)
  );
}
