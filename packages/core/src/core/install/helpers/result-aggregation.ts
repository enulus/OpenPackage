/**
 * Result Aggregation Helpers
 * 
 * Shared utilities for aggregating installation results across multiple packages or platforms.
 * Handles merging of file mappings, conflicts, errors, and statistics.
 */

import type { FlowInstallResult } from '../strategies/types.js';
import type { WorkspaceIndexFileMapping } from '../../../types/workspace-index.js';

/**
 * Merge file mappings from multiple results
 * Simple deduplication by concatenating unique targets
 * 
 * @param target - Target mapping to merge into (mutated)
 * @param source - Source mapping to merge from
 */
export function mergeFileMappings(
  target: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  source: Record<string, (string | WorkspaceIndexFileMapping)[]>
): void {
  for (const [sourceKey, targets] of Object.entries(source)) {
    const existing = target[sourceKey] ?? [];
    target[sourceKey] = Array.from(new Set([...existing, ...targets])).sort();
  }
}

/**
 * Merge file mappings with workspace index format
 * Prefers complex mappings over simple strings, deduplicates by target path
 * 
 * This is used by flow-index-installer which needs to handle both string and
 * WorkspaceIndexFileMapping formats.
 * 
 * @param target - Target mapping to merge into (mutated)
 * @param source - Source mapping to merge from
 */
export function mergeWorkspaceFileMappings(
  target: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  source: Record<string, (string | WorkspaceIndexFileMapping)[]>
): void {
  for (const [sourceKey, targets] of Object.entries(source)) {
    const existing = target[sourceKey] ?? [];
    
    // Deduplicate by target path, prefer complex mapping over string
    const byTarget = new Map<string, string | WorkspaceIndexFileMapping>();
    
    for (const m of existing) {
      const targetPath = typeof m === 'string' ? m : m.target;
      byTarget.set(targetPath, m);
    }
    
    for (const m of targets) {
      const targetPath = typeof m === 'string' ? m : m.target;
      const prior = byTarget.get(targetPath);
      
      if (!prior) {
        byTarget.set(targetPath, m);
      } else if (typeof prior === 'string' && typeof m !== 'string') {
        // Prefer complex mapping over string
        byTarget.set(targetPath, m);
      }
    }
    
    target[sourceKey] = Array.from(byTarget.values());
  }
}

/**
 * Aggregate flow install results
 * 
 * Merges statistics, errors, conflicts, target paths, and file mappings from
 * source into target. Target is mutated.
 * 
 * @param target - Target result to aggregate into (mutated)
 * @param source - Source result to aggregate from
 */
export function aggregateFlowResults(
  target: FlowInstallResult,
  source: FlowInstallResult
): void {
  target.filesProcessed += source.filesProcessed;
  target.filesWritten += source.filesWritten;
  target.errors.push(...source.errors);
  target.conflicts.push(...source.conflicts);
  target.targetPaths.push(...(source.targetPaths ?? []));
  
  mergeFileMappings(target.fileMapping, source.fileMapping ?? {});
  
  if (!source.success) {
    target.success = false;
  }
}

/**
 * Collect unique conflict messages
 * 
 * Converts FlowConflictReport objects to strings and adds unique messages to target array.
 * Used by flow-index-installer to aggregate conflicts across platforms.
 * 
 * @param target - Target array to add messages to (mutated)
 * @param conflicts - Source conflicts to convert and add
 */
export function collectConflictMessages(
  target: string[],
  conflicts: FlowInstallResult['conflicts']
): void {
  for (const conflict of conflicts) {
    const msg = `${conflict.targetPath}: ${conflict.message}`;
    if (!target.includes(msg)) {
      target.push(msg);
    }
  }
}

/**
 * Collect unique error messages
 * 
 * Converts FlowInstallError objects to strings and adds unique messages to target array.
 * Used by flow-index-installer to aggregate errors across platforms.
 * 
 * @param target - Target array to add messages to (mutated)
 * @param errors - Source errors to convert and add
 */
export function collectErrorMessages(
  target: string[],
  errors: FlowInstallResult['errors']
): void {
  for (const error of errors) {
    const msg = `${error.sourcePath}: ${error.message}`;
    if (!target.includes(msg)) {
      target.push(msg);
    }
  }
}
