/**
 * Dependency Containment Validation
 *
 * Ensures that all local path dependencies resolve within the package root.
 * Used at publish time to prevent packages from referencing external paths
 * that won't exist for consumers.
 */

import path from 'path';

import { resolveDeclaredPath } from '../path-resolution.js';
import type { PackageYml, PackageDependency } from '../../types/index.js';

export interface ContainmentViolation {
  /** Dependency name */
  name: string;
  /** Declared path in the manifest */
  declaredPath: string;
  /** Resolved absolute path */
  resolvedPath: string;
  /** Reason for violation */
  reason: 'escapes-root' | 'absolute-external';
}

export interface ContainmentResult {
  valid: boolean;
  violations: ContainmentViolation[];
}

/**
 * Validate that all local path dependencies resolve within the package root.
 *
 * Only checks dependencies with a `path` field and no `url`/`git` field
 * (those are subdirectories within a remote repo, not local filesystem paths).
 *
 * @param manifest - Parsed openpackage.yml
 * @param packageRoot - Absolute path to the package root directory
 */
export function validateDependencyContainment(
  manifest: PackageYml,
  packageRoot: string
): ContainmentResult {
  const violations: ContainmentViolation[] = [];

  const allDeps: PackageDependency[] = [
    ...(manifest.dependencies ?? []),
    ...(manifest['dev-dependencies'] ?? []),
  ];

  for (const dep of allDeps) {
    // Only check local path deps (no url/git)
    if (!dep.path || dep.url || dep.git) continue;

    const { absolute: resolvedAbs } = resolveDeclaredPath(dep.path, packageRoot);
    const relative = path.relative(packageRoot, resolvedAbs);

    // Violation: path escapes the package root (starts with '..')
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      violations.push({
        name: dep.name,
        declaredPath: dep.path,
        resolvedPath: resolvedAbs,
        reason: relative.startsWith('..') ? 'escapes-root' : 'absolute-external',
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Format containment violations into a user-friendly error message.
 */
export function formatContainmentViolations(violations: ContainmentViolation[]): string {
  const lines = violations.map(v => {
    const advice = v.reason === 'escapes-root'
      ? `Move the dependency into the package or use a registry/git source instead.`
      : `Use a relative path within the package root instead.`;
    return `  - ${v.name} (path: ${v.declaredPath}): ${advice}`;
  });

  return [
    `Package contains ${violations.length} path dependency violation${violations.length > 1 ? 's' : ''}:`,
    ...lines,
    '',
    'All local path dependencies must resolve within the package root for publishing.',
  ].join('\n');
}
