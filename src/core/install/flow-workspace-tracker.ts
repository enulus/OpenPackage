/**
 * Flow Workspace Tracker
 * 
 * Tracks files and keys written by flow-based installations
 * for precise removal during uninstall.
 */

import path from 'path';
import type { FlowResult } from '../../types/flows.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';

/**
 * Build workspace index file mappings from flow results
 * Includes key tracking for merged files
 * 
 * @param flowResults - Results from executing flows
 * @returns File mappings for workspace index
 */
export function buildFileMappingsFromFlowResults(
  flowResults: FlowResult[]
): Record<string, (string | WorkspaceIndexFileMapping)[]> {
  const mappings: Record<string, (string | WorkspaceIndexFileMapping)[]> = {};

  for (const result of flowResults) {
    if (!result.success) {
      continue; // Skip failed flows
    }

    // Handle both single and multiple targets
    const targets = Array.isArray(result.target) ? result.target : [result.target];

    for (const target of targets) {
      // Normalize target path
      const normalizedTarget = path.normalize(target).replace(/\\/g, '/');

      // Determine if we need complex mapping with key tracking
      const needsKeyTracking = 
        result.keys && 
        result.keys.length > 0 && 
        result.merge && 
        result.merge !== 'replace' && 
        result.merge !== 'composite';

      if (needsKeyTracking) {
        // Create complex mapping with key tracking
        const mapping: WorkspaceIndexFileMapping = {
          target: normalizedTarget,
          merge: result.merge,
          keys: result.keys
        };

        // Add to mappings under source key
        if (!mappings[result.source]) {
          mappings[result.source] = [];
        }
        mappings[result.source].push(mapping);
      } else {
        // Simple string mapping
        if (!mappings[result.source]) {
          mappings[result.source] = [];
        }
        mappings[result.source].push(normalizedTarget);
      }
    }
  }

  // Deduplicate mappings
  for (const [source, targets] of Object.entries(mappings)) {
    // Create a map to track unique targets
    const seenTargets = new Map<string, string | WorkspaceIndexFileMapping>();

    for (const mapping of targets) {
      const targetPath = typeof mapping === 'string' ? mapping : mapping.target;

      if (!seenTargets.has(targetPath)) {
        seenTargets.set(targetPath, mapping);
      } else {
        // If we see the same target again, prefer the complex mapping with keys
        const existing = seenTargets.get(targetPath)!;
        if (typeof existing === 'string' && typeof mapping !== 'string') {
          seenTargets.set(targetPath, mapping);
        }
      }
    }

    mappings[source] = Array.from(seenTargets.values());
  }

  return mappings;
}

/**
 * Merge new flow results into existing file mappings
 * Used when installing additional packages
 * 
 * @param existing - Existing file mappings
 * @param newResults - New flow results to merge
 * @returns Merged file mappings
 */
export function mergeFileMappings(
  existing: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  newResults: FlowResult[]
): Record<string, (string | WorkspaceIndexFileMapping)[]> {
  const newMappings = buildFileMappingsFromFlowResults(newResults);

  const merged = { ...existing };

  for (const [source, targets] of Object.entries(newMappings)) {
    if (!merged[source]) {
      merged[source] = targets;
    } else {
      // Merge targets, avoiding duplicates
      const existingTargets = merged[source];
      const seenTargets = new Set<string>();

      // Add existing targets
      for (const mapping of existingTargets) {
        const targetPath = typeof mapping === 'string' ? mapping : mapping.target;
        seenTargets.add(targetPath);
      }

      // Add new targets that don't exist
      for (const mapping of targets) {
        const targetPath = typeof mapping === 'string' ? mapping : mapping.target;
        if (!seenTargets.has(targetPath)) {
          merged[source].push(mapping);
          seenTargets.add(targetPath);
        }
      }
    }
  }

  return merged;
}
