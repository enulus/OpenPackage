/**
 * Conflict Detection Helpers
 * 
 * Utilities for detecting conflicts when multiple packages write to the same target files.
 * Used for multi-package priority-based conflict detection (e.g. in tests).
 */

import type { Flow } from '../../../types/flows.js';
import type { FlowContext } from '../../../types/flows.js';
import type { FlowConflictReport } from '../strategies/types.js';
import { discoverFlowSources } from '../../flows/flow-source-discovery.js';
import { resolvePattern } from '../../flows/flow-source-discovery.js';

/**
 * Represents a package that writes to a target file
 */
export interface FileTargetWriter {
  packageName: string;
  priority: number;
}

/**
 * Track target files written by a package for conflict detection
 * 
 * Discovers which files a package will write to and tracks them in the fileTargets map.
 * Multiple packages writing to the same target will be detected as conflicts.
 * 
 * @param fileTargets - Map tracking which packages write to which targets (mutated)
 * @param packageName - Name of the package
 * @param priority - Priority of the package (higher priority wins conflicts)
 * @param packageRoot - Root directory of the package
 * @param flows - Applicable flows for this installation
 * @param flowContext - Flow execution context
 */
export async function trackTargetFiles(
  fileTargets: Map<string, FileTargetWriter[]>,
  packageName: string,
  priority: number,
  packageRoot: string,
  flows: Flow[],
  flowContext: FlowContext
): Promise<void> {
  const flowSources = await discoverFlowSources(flows, packageRoot, flowContext);
  
  for (const [flow, sources] of flowSources) {
    if (sources.length > 0) {
      // Determine target path from flow
      const targetPath = typeof flow.to === 'string' 
        ? resolvePattern(flow.to, flowContext)
        : Object.keys(flow.to)[0];
      
      // Track this package writing to this target
      if (!fileTargets.has(targetPath)) {
        fileTargets.set(targetPath, []);
      }
      fileTargets.get(targetPath)!.push({
        packageName,
        priority
      });
    }
  }
}

/**
 * Generate conflict reports from tracked file targets
 * 
 * Analyzes the fileTargets map to find files written by multiple packages.
 * The package with the highest priority wins; others are reported as overwritten.
 * 
 * @param fileTargets - Map of target paths to packages that write to them
 * @returns Array of conflict reports
 */
export function generateConflictReports(
  fileTargets: Map<string, FileTargetWriter[]>
): FlowConflictReport[] {
  const conflicts: FlowConflictReport[] = [];
  
  for (const [targetPath, writers] of fileTargets) {
    if (writers.length > 1) {
      // Sort by priority to determine winner (higher priority wins)
      const sortedWriters = [...writers].sort((a, b) => b.priority - a.priority);
      const winner = sortedWriters[0];
      const losers = sortedWriters.slice(1);
      
      conflicts.push({
        targetPath,
        packages: sortedWriters.map((w, i) => ({
          packageName: w.packageName,
          priority: w.priority,
          chosen: i === 0
        })),
        message: `Conflict in ${targetPath}: ${winner.packageName} (priority ${winner.priority}) overwrites ${losers.map(w => w.packageName).join(', ')}`
      });
    }
  }
  
  return conflicts;
}
