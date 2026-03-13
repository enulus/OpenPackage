/**
 * Prefix-Based Resource Namespace Path Generation
 *
 * Generates namespaced paths by prepending `slug-` to the leaf segment
 * (file or marker-bounded directory) rather than inserting a subdirectory.
 *
 * This approach ensures flat name discovery (e.g. Claude Code's leaf-name
 * identity) can distinguish resources from different packages.
 */

import { stripExtension } from '../../resources/resource-naming.js';
import { getInstallableTypes } from '../../resources/resource-registry.js';

// Module-level constant: marker filenames derived from the resource registry.
const MARKER_FILENAMES: Set<string> = new Set(
  getInstallableTypes().map(d => d.marker).filter(Boolean) as string[]
);

/**
 * Dedup rule: returns true when prefixing would be redundant because the
 * leaf name (sans extension) already equals the slug.
 *
 * Example: slug="code-review", leaf="code-review.md" → skip prefix.
 */
export function shouldSkipPrefix(leafName: string, slug: string): boolean {
  return stripExtension(leafName) === slug;
}

/**
 * Derive the base directory from a flow `to` pattern — the longest
 * non-glob prefix directory.  Mirrors the algorithm previously in
 * `generateNamespacedPath`.
 */
function deriveBaseDir(flowToPattern: string | undefined): string {
  if (!flowToPattern) return '';

  const patternNorm = flowToPattern.replace(/\\/g, '/');
  const firstGlob = patternNorm.search(/[*?{]/);

  if (firstGlob > 0) {
    const prefix = patternNorm.slice(0, firstGlob).replace(/\/$/, '');
    if (patternNorm[firstGlob - 1]?.match(/\//)) {
      return prefix;
    }
    return prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
  }

  if (firstGlob === -1) {
    // Literal pattern — base is the directory of the literal target
    const lastSlash = patternNorm.lastIndexOf('/');
    return lastSlash >= 0 ? patternNorm.slice(0, lastSlash) : '';
  }

  return '';
}

/**
 * Generate a prefix-based namespaced leaf path.
 *
 * Instead of inserting a subdirectory (`rules/acme/foo.md`), this prepends
 * `slug-` to the leaf:  `rules/acme-foo.md`.
 *
 * For marker-based resources (e.g. skills with SKILL.md), the parent
 * directory is prefixed instead of the file:
 *   `commands/review/SKILL.md` → `commands/pkg-a-review/SKILL.md`
 *
 * Dedup rule: if the leaf name (sans extension) already equals the slug,
 * the path is returned unchanged.
 *
 * @param relPath         Workspace-relative path (forward-slash normalised)
 * @param slug            Short namespace slug (e.g. "acme", "my-pkg")
 * @param flowToPattern   The resolved flow `to` pattern (used to derive base dir)
 */
export function generatePrefixedLeafPath(
  relPath: string,
  slug: string,
  flowToPattern: string | undefined
): string {
  const normalized = relPath.replace(/\\/g, '/');

  // Derive base directory from flow pattern
  const baseDir = deriveBaseDir(flowToPattern);

  // Split path into base + remainder
  let remainder: string;
  if (baseDir) {
    const baseDirSlash = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
    if (normalized.startsWith(baseDirSlash)) {
      remainder = normalized.slice(baseDirSlash.length);
    } else if (normalized === baseDir) {
      // Edge case: path equals base dir exactly
      return `${baseDir}`;
    } else {
      // Fallback if base doesn't match
      remainder = normalized;
    }
  } else {
    remainder = normalized;
  }

  const parts = remainder.split('/');
  const leaf = parts[parts.length - 1];

  // Check if the leaf is a marker file (e.g. SKILL.md)
  if (MARKER_FILENAMES.has(leaf) && parts.length >= 2) {
    // Marker-based resource: prefix the parent directory
    // e.g. parts = ["review", "SKILL.md"] → ["slug-review", "SKILL.md"]
    // or parts = ["review", "agents", "x.md"] → ["slug-review", "agents", "x.md"]
    // Find the marker boundary — the directory just before the marker file
    // For nested files under the skill dir, the boundary is the first segment
    // that represents the skill directory name.
    const parentIdx = 0; // The skill directory is always the first segment under the base
    const parentDir = parts[parentIdx];

    if (shouldSkipPrefix(parentDir, slug)) {
      return baseDir ? `${baseDir}/${remainder}` : remainder;
    }

    parts[parentIdx] = `${slug}-${parentDir}`;
    const newRemainder = parts.join('/');
    return baseDir ? `${baseDir}/${newRemainder}` : newRemainder;
  }

  // File-based prefixing: prepend slug to leaf filename
  if (shouldSkipPrefix(leaf, slug)) {
    return baseDir ? `${baseDir}/${remainder}` : remainder;
  }

  if (parts.length === 1) {
    // Single-segment remainder (just a filename)
    return baseDir ? `${baseDir}/${slug}-${leaf}` : `${slug}-${leaf}`;
  }

  // Multi-segment: prefix the leaf (last segment)
  const parentParts = parts.slice(0, -1);
  const prefixedLeaf = `${slug}-${leaf}`;
  const newRemainder = [...parentParts, prefixedLeaf].join('/');
  return baseDir ? `${baseDir}/${newRemainder}` : newRemainder;
}
