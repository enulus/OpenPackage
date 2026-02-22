/**
 * Display utilities for dependency resolution results.
 */

import type { ResolvedPackage } from './types.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

/**
 * Display dependency tree to user
 */
export function displayDependencyTree(resolvedPackages: ResolvedPackage[], silent: boolean = false, output?: OutputPort): void {
  if (silent) return;
  const out = output ?? resolveOutput();
  const root = resolvedPackages.find(f => f.isRoot);
  if (!root) return;
  
  out.info(`\nInstalling ${root.name}@${root.version} with dependencies:\n`);
  
  // Show root
  out.info(`${root.name}@${root.version} (root)`);
  
  // Show transitive dependencies
  const transitive = resolvedPackages.filter(f => !f.isRoot);
  for (const dep of transitive) {
    const status = dep.conflictResolution 
      ? ` (${dep.conflictResolution})`
      : '';
    
    // Show version range information if available
    const rangeInfo = dep.requiredRange && dep.requiredRange !== dep.version
      ? ` [from ${dep.requiredRange}]`
      : '';
    
    out.info(`├── ${dep.name}@${dep.version}${rangeInfo}${status}`);
  }
  
  out.info(`\nTotal: ${resolvedPackages.length} packages\n`);
}
