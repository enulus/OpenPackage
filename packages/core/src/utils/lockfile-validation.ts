/**
 * Lockfile freshness validation.
 *
 * Compares the root manifest's declared dependencies against the lockfile
 * to determine if the lockfile can be used for fast install (skip resolution).
 */

import type { PackageYml } from '../types/index.js';
import type { Lockfile } from '../types/lockfile.js';
import { normalizePackageName } from './package-name.js';

export interface LockfileValidationResult {
  fresh: boolean;
  reason?: string;
}

/**
 * Check whether the lockfile is fresh (matches the root manifest).
 *
 * The lockfile is stale when:
 * - A manifest dependency is missing from the lockfile
 * - A lockfile entry uses a path source (content may have changed)
 * - A lockfile entry uses a git source without a pinned commit ref
 */
export function validateLockfileFreshness(
  manifest: PackageYml,
  lockfile: Lockfile,
): LockfileValidationResult {
  if (Object.keys(lockfile.packages).length === 0) {
    return { fresh: false, reason: 'Lockfile is empty' };
  }

  // Extract all declared dependency names from root manifest
  const deps = manifest.dependencies ?? (manifest as any).packages ?? [];
  const devDeps = manifest['dev-dependencies'] ?? (manifest as any)['dev-packages'] ?? [];
  const allDeclared = [...deps, ...devDeps].filter(Boolean);

  const manifestDepNames = new Set<string>();
  for (const dep of allDeclared) {
    if (dep?.name) {
      manifestDepNames.add(normalizePackageName(dep.name));
    }
  }

  // Check every manifest dep exists in lockfile
  for (const depName of manifestDepNames) {
    if (!lockfile.packages[depName]) {
      return { fresh: false, reason: `New dependency: ${depName}` };
    }
  }

  // Check for ghost deps in lockfile (direct deps that were removed)
  // Note: transitive deps in the lockfile that aren't in the manifest are OK
  // We only flag if a ROOT-level dep was removed. Since we can't distinguish
  // root from transitive in the lockfile, we skip this strict check.
  // The manifest dep check above is sufficient for freshness.

  // Check source stability
  for (const [pkgName, entry] of Object.entries(lockfile.packages)) {
    // Path sources: content may have changed on disk
    if ((entry.base || entry.path) && !entry.url) {
      return { fresh: false, reason: `Path source for ${pkgName}` };
    }
    // Git sources without pinned commit SHA: branch may have moved
    if (entry.url && !entry.ref) {
      return { fresh: false, reason: `Unpinned git source for ${pkgName}` };
    }
    // Git with ref (pinned commit SHA): stable, allow
    // Registry (no path/url): stable, allow
  }

  return { fresh: true };
}
