/**
 * Semver constraint resolution for registry packages in the dependency graph.
 * Finds compatible versions across multiple declarations with different constraints.
 */

import semver from 'semver';
import type { DependencyGraph, ResolutionDependencyNode } from './types.js';

export interface VersionSolution {
  resolved: Map<string, string>;
  conflicts: VersionConflict[];
}

export interface VersionConflict {
  packageName: string;
  ranges: string[];
  requestedBy: string[];
}

export interface SolverOptions {
  force?: boolean;
  allowPrerelease?: boolean;
  onConflict?: (conflict: VersionConflict, availableVersions: string[]) => Promise<string | null>;
}

interface PackageConstraint {
  range: string;
  requestedBy: string;
}

/**
 * Solve version constraints for all registry packages in the dependency graph.
 * Groups nodes by package name, finds intersecting semver ranges, and picks
 * the highest satisfying version.
 */
export async function solveVersions(
  graph: DependencyGraph,
  options: SolverOptions = {}
): Promise<VersionSolution> {
  const { force = false, allowPrerelease = false, onConflict } = options;
  const resolved = new Map<string, string>();
  const conflicts: VersionConflict[] = [];

  const registryPackages = groupRegistryNodesByPackage(graph);

  for (const [packageName, nodes] of registryPackages) {
    const constraints = extractConstraints(nodes);
    
    if (constraints.length === 0) {
      continue;
    }

    const ranges = constraints.map(c => c.range);
    const requestedBy = constraints.map(c => c.requestedBy);
    const availableVersions = extractAvailableVersions(nodes);

    const satisfyingVersion = findHighestSatisfyingVersion(
      ranges,
      availableVersions,
      allowPrerelease
    );

    if (satisfyingVersion) {
      resolved.set(packageName, satisfyingVersion);
    } else if (force && availableVersions.length > 0) {
      const highest = semver.maxSatisfying(availableVersions, '*', { includePrerelease: allowPrerelease });
      if (highest) {
        resolved.set(packageName, highest);
      }
      conflicts.push({ packageName, ranges, requestedBy });
    } else {
      const conflict: VersionConflict = { packageName, ranges, requestedBy };
      
      if (onConflict && availableVersions.length > 0) {
        const chosenVersion = await onConflict(conflict, availableVersions);
        if (chosenVersion) {
          resolved.set(packageName, chosenVersion);
          continue;
        }
      }
      
      conflicts.push(conflict);
    }
  }

  return { resolved, conflicts };
}

function groupRegistryNodesByPackage(
  graph: DependencyGraph
): Map<string, ResolutionDependencyNode[]> {
  const grouped = new Map<string, ResolutionDependencyNode[]>();

  for (const node of graph.nodes.values()) {
    if (node.source.type !== 'registry' || !node.source.packageName) {
      continue;
    }

    const packageName = node.source.packageName;
    const existing = grouped.get(packageName) || [];
    existing.push(node);
    grouped.set(packageName, existing);
  }

  return grouped;
}

function extractConstraints(nodes: ResolutionDependencyNode[]): PackageConstraint[] {
  const constraints: PackageConstraint[] = [];

  for (const node of nodes) {
    for (const decl of node.declarations) {
      const range = normalizeVersionRange(decl.version);
      if (range) {
        constraints.push({
          range,
          requestedBy: decl.declaredIn
        });
      }
    }
  }

  return constraints;
}

function normalizeVersionRange(version?: string): string | null {
  if (!version) return null;
  
  const normalized = version.trim().toLowerCase();
  if (normalized === '*' || normalized === 'latest' || normalized === '') {
    return null;
  }
  
  return version.trim();
}

function extractAvailableVersions(nodes: ResolutionDependencyNode[]): string[] {
  const versions = new Set<string>();

  for (const node of nodes) {
    if (node.source.resolvedVersion) {
      versions.add(node.source.resolvedVersion);
    }
    if (node.loaded?.version) {
      versions.add(node.loaded.version);
    }
  }

  return Array.from(versions).filter(v => semver.valid(v));
}

function findHighestSatisfyingVersion(
  ranges: string[],
  availableVersions: string[],
  allowPrerelease: boolean
): string | null {
  if (availableVersions.length === 0) {
    return null;
  }

  const satisfyingVersions = availableVersions.filter(version => {
    return ranges.every(range => {
      try {
        return semver.satisfies(version, range, { includePrerelease: allowPrerelease });
      } catch {
        return false;
      }
    });
  });

  if (satisfyingVersions.length === 0) {
    return null;
  }

  return semver.maxSatisfying(satisfyingVersions, '*', { includePrerelease: allowPrerelease });
}

/**
 * Check if a specific version satisfies all given constraints.
 */
export function versionSatisfiesAll(
  version: string,
  ranges: string[],
  allowPrerelease = false
): boolean {
  return ranges.every(range => {
    try {
      return semver.satisfies(version, range, { includePrerelease: allowPrerelease });
    } catch {
      return false;
    }
  });
}

/**
 * Find the intersection range of multiple semver ranges (as a displayable string).
 * Returns null if ranges are incompatible.
 */
export function intersectRanges(ranges: string[]): string | null {
  if (ranges.length === 0) return null;
  if (ranges.length === 1) return ranges[0];

  const validRanges = ranges.filter(r => {
    try {
      return semver.validRange(r) !== null;
    } catch {
      return false;
    }
  });

  if (validRanges.length === 0) return null;

  return validRanges.join(' ');
}

/**
 * Create an interactive conflict handler that uses promptVersionSelection.
 * Returns a handler function suitable for the onConflict option.
 * 
 * @param promptVersionSelection - The prompt function to use for version selection
 * @returns An onConflict handler function
 */
export function createInteractiveConflictHandler(
  promptVersionSelection: (packageName: string, versions: string[], action?: string) => Promise<string | null>
): (conflict: VersionConflict, availableVersions: string[]) => Promise<string | null> {
  return async (conflict: VersionConflict, availableVersions: string[]): Promise<string | null> => {
    const sortedVersions = [...availableVersions].sort((a, b) => semver.rcompare(a, b));
    const rangesStr = conflict.ranges.join(', ');
    const action = `(requested ranges: ${rangesStr})`;
    
    return promptVersionSelection(conflict.packageName, sortedVersions, action);
  };
}
