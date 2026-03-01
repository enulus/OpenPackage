/**
 * Resource Namespace Module
 *
 * Single source of truth for deriving category/namespace from paths.
 * Used by list pipeline, scope merger, and future consumers.
 */

import { stripExtension } from './resource-naming.js';
import { getResourceTypeDef, getMarkerFilename, findMarkerIndex, toPluralKey, type ResourceTypeId } from './resource-registry.js';
import { stripPlatformSuffixFromFilename } from '../flows/platform-suffix-handler.js';

/**
 * Extract the path segment under a category directory from a full path.
 * Handles both source keys (rules/foo.mdc) and workspace paths (.cursor/rules/foo.mdc).
 *
 * @param path - Normalized path (source key, target, or workspace path)
 * @param categoryDir - The category directory (e.g., 'rules', 'agents')
 * @returns Path under category, or null if category not found
 */
export function getPathUnderCategory(path: string, categoryDir: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');

  const idx = parts.indexOf(categoryDir);
  if (idx < 0) return null;

  const remaining = parts.slice(idx + 1);
  return remaining.length > 0 ? remaining.join('/') : '';
}

/**
 * Derive the namespace (path under category with extension stripped from last segment).
 * - File-based: "basics/custom-rules.mdc" → "basics/custom-rules"
 * - Skill: "my-skill/readme.md" → "my-skill" (first segment, directory-based)
 *
 * @param pathUnderCategory - Path under the category directory
 * @param resourceType - Singular type: rule, agent, skill, etc.
 */
function deriveNamespace(pathUnderCategory: string, resourceType: ResourceTypeId): string {
  if (!pathUnderCategory || pathUnderCategory === '') return 'unnamed';

  const parts = pathUnderCategory.split('/');

  const marker = getMarkerFilename(resourceType);
  if (marker) {
    return deriveMarkerNamespace(parts, marker);
  }

  // Strip platform suffix (e.g. git-manager.opencode.md -> git-manager.md) so platform-specific
  // variants group under the same resource
  const pathStripped = stripPlatformSuffixFromFilename(pathUnderCategory);
  const strippedParts = pathStripped.split('/');
  const lastSegment = strippedParts[strippedParts.length - 1] ?? '';
  const nameWithoutExt = stripExtension(lastSegment);

  if (strippedParts.length === 1) {
    return nameWithoutExt || lastSegment;
  }

  const subpath = strippedParts.slice(0, -1).join('/');
  return subpath ? `${subpath}/${nameWithoutExt}` : nameWithoutExt;
}

/**
 * Derive the full resource identifier (category/namespace) from a path.
 *
 * @param path - Source key, target path, or workspace path
 * @param resourceType - Singular type: rule, agent, skill, command, hook, mcp, other
 * @returns Full name like "rules/custom-rules", "rules/basics/custom-rules", "agents/agent-creator"
 */
export function deriveResourceFullName(path: string, resourceType: ResourceTypeId): string {
  const normalizedType = resourceType as ResourceTypeId;

  if (normalizedType === 'mcp') {
    return 'mcps/configs';
  }

  if (normalizedType === 'other') {
    return 'other';
  }

  const def = getResourceTypeDef(normalizedType);
  const categoryDir = def.dirName;

  if (!categoryDir) {
    return `other/${deriveNamespace(path, 'other')}`;
  }

  const pathUnder = getPathUnderCategory(path, categoryDir);
  if (pathUnder === null) {
    const pluralKey = toPluralKey(normalizedType);
    const fallback = path.replace(/\\/g, '/').split('/').pop() ?? 'unnamed';
    return `${pluralKey}/${stripExtension(fallback)}`;
  }

  const namespace = deriveNamespace(pathUnder, normalizedType);
  const pluralKey = toPluralKey(normalizedType);
  return `${pluralKey}/${namespace}`;
}

/**
 * Derive namespace for a marker-based resource type from its path segments.
 *
 * Marker-based resources (e.g. skills with SKILL.md) use the parent directory
 * of the marker file as the namespace boundary. For paths containing the marker,
 * everything before it is the namespace. For other files, falls back to the
 * first segment.
 */
function deriveMarkerNamespace(parts: string[], marker: string): string {
  const idx = findMarkerIndex(parts, marker);
  if (idx > 0) {
    return parts.slice(0, idx).join('/');
  }
  return parts[0] || 'unnamed';
}

/**
 * Scan a list of paths and extract namespace boundaries by finding marker
 * file entries for the given resource type.
 *
 * Returns boundaries sorted longest-first so callers can match greedily.
 */
export function buildMarkerBoundaries(paths: string[], resourceType: ResourceTypeId): string[] {
  const marker = getMarkerFilename(resourceType);
  if (!marker) return [];

  const def = getResourceTypeDef(resourceType);
  const categoryDir = def.dirName;
  if (!categoryDir) return [];

  const boundaries = new Set<string>();
  for (const p of paths) {
    const pathUnder = getPathUnderCategory(p, categoryDir);
    if (pathUnder === null) continue;
    const parts = pathUnder.split('/');
    const idx = findMarkerIndex(parts, marker);
    if (idx > 0) {
      boundaries.add(parts.slice(0, idx).join('/'));
    }
  }
  // Sort longest-first for greedy prefix matching
  return Array.from(boundaries).sort((a, b) => b.length - a.length);
}

/**
 * Derive the full resource name for a file belonging to a marker-based
 * resource type, using pre-computed boundaries to correctly group files
 * under nested directories.
 *
 * Falls back to standard derivation when no boundary matches.
 */
export function deriveMarkerFullName(path: string, resourceType: ResourceTypeId, boundaries: string[]): string {
  const def = getResourceTypeDef(resourceType);
  const categoryDir = def.dirName;
  const pluralKey = toPluralKey(resourceType);

  if (!categoryDir) {
    const fallback = path.replace(/\\/g, '/').split('/').pop() ?? 'unnamed';
    return `${pluralKey}/${stripExtension(fallback)}`;
  }

  const pathUnder = getPathUnderCategory(path, categoryDir);
  if (pathUnder === null) {
    const fallback = path.replace(/\\/g, '/').split('/').pop() ?? 'unnamed';
    return `${pluralKey}/${stripExtension(fallback)}`;
  }

  // Try matching against known boundaries (longest-first)
  for (const boundary of boundaries) {
    if (pathUnder === boundary || pathUnder.startsWith(boundary + '/')) {
      return `${pluralKey}/${boundary}`;
    }
  }

  // Fallback: use standard marker namespace derivation
  const marker = getMarkerFilename(resourceType);
  const parts = pathUnder.split('/');
  return `${pluralKey}/${marker ? deriveMarkerNamespace(parts, marker) : parts[0] || 'unnamed'}`;
}
