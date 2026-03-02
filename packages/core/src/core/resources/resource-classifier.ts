/**
 * Unified Resource Classifier
 *
 * Batch-classifies source keys and untracked paths into resource identities,
 * correctly handling marker-based types (e.g. nested skills with SKILL.md)
 * via pre-scan + boundary matching.
 *
 * Replaces per-key classification from source-key-classifier.ts which used
 * naive parts[1] logic and broke nested skill names.
 */

import { DIR_TO_TYPE, type ResourceTypeId } from './resource-registry.js';
import { getMarkerFilename, getResourceTypeDef } from './resource-registry.js';
import { buildMarkerBoundaries, deriveMarkerFullName, deriveResourceFullName, getPathUnderCategory } from './resource-namespace.js';
import { normalizeType, toPluralKey } from './resource-registry.js';

export interface GroupedUntrackedResource {
  resourceType: ResourceTypeId;
  resourceName: string;
  fullName: string;
  filePaths: string[];
}

export interface ClassifiedResource {
  resourceType: ResourceTypeId;
  resourceName: string;   // e.g. "openpackage/skill-creator"
  fullName: string;        // e.g. "skills/openpackage/skill-creator"
}

/**
 * Detect the resource type from a source key's first path segment.
 * Returns 'mcp' for mcp.json/mcp.jsonc, 'other' for unrecognized dirs.
 */
function detectTypeFromSourceKey(sourceKey: string): ResourceTypeId {
  const normalized = sourceKey.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');

  if (parts.length === 1 && (sourceKey === 'mcp.json' || sourceKey === 'mcp.jsonc')) {
    return 'mcp';
  }

  return DIR_TO_TYPE[parts[0]] ?? 'other';
}

/**
 * Extract resourceName from fullName by stripping the plural prefix.
 * e.g. "skills/openpackage/skill-creator" → "openpackage/skill-creator"
 *      "rules/basics/custom-rules" → "basics/custom-rules"
 *      "mcps/configs" → "configs"
 *      "other" → "other"
 */
function extractResourceName(fullName: string, resourceType: ResourceTypeId): string {
  const pluralKey = toPluralKey(resourceType);
  const prefix = pluralKey + '/';
  if (fullName.startsWith(prefix)) {
    return fullName.slice(prefix.length);
  }
  // For 'other' type, fullName is just "other"
  return fullName;
}

/**
 * Batch-classify source keys (tracked resources from workspace index).
 *
 * Groups keys by type, builds marker boundaries for marker-based types,
 * then derives the correct fullName for each key.
 *
 * @invariant Always returns an entry for every input key — no keys are
 * skipped. The `!` non-null assertions at call sites are therefore safe.
 */
export function classifySourceKeyBatch(sourceKeys: string[]): Map<string, ClassifiedResource> {
  const result = new Map<string, ClassifiedResource>();
  if (sourceKeys.length === 0) return result;

  // Step 1: Detect type per key and group by type
  const typeMap = new Map<ResourceTypeId, string[]>();
  const keyTypes = new Map<string, ResourceTypeId>();

  for (const key of sourceKeys) {
    const resourceType = detectTypeFromSourceKey(key);
    keyTypes.set(key, resourceType);
    if (!typeMap.has(resourceType)) {
      typeMap.set(resourceType, []);
    }
    typeMap.get(resourceType)!.push(key);
  }

  // Step 2: Build marker boundaries for types that have markers
  const boundaryCache = new Map<ResourceTypeId, string[]>();
  for (const [resourceType, keys] of typeMap) {
    if (getMarkerFilename(resourceType)) {
      boundaryCache.set(resourceType, buildMarkerBoundaries(keys, resourceType));
    }
  }

  // Step 3: Classify each key
  for (const key of sourceKeys) {
    const resourceType = keyTypes.get(key)!;
    const boundaries = boundaryCache.get(resourceType);
    const fullName = boundaries && boundaries.length > 0
      ? deriveMarkerFullName(key, resourceType, boundaries)
      : deriveResourceFullName(key, resourceType);
    const resourceName = extractResourceName(fullName, resourceType);

    result.set(key, { resourceType, resourceName, fullName });
  }

  return result;
}

/**
 * Batch-classify untracked paths (type already known from scanner).
 *
 * Similar to classifySourceKeyBatch but uses the provided resourceType
 * instead of detecting from path prefix, and operates on workspace paths
 * (which may have platform-specific prefixes like `.claude/skills/...`).
 */
export function classifyUntrackedPaths(
  files: Array<{ path: string; resourceType: ResourceTypeId }>
): Map<string, ClassifiedResource> {
  const result = new Map<string, ClassifiedResource>();
  if (files.length === 0) return result;

  // Step 1: Group by type
  const typeMap = new Map<ResourceTypeId, string[]>();
  const pathTypes = new Map<string, ResourceTypeId>();

  for (const file of files) {
    pathTypes.set(file.path, file.resourceType);
    if (!typeMap.has(file.resourceType)) {
      typeMap.set(file.resourceType, []);
    }
    typeMap.get(file.resourceType)!.push(file.path);
  }

  // Step 2: Build marker boundaries for types that have markers
  const boundaryCache = new Map<ResourceTypeId, string[]>();
  for (const [resourceType, paths] of typeMap) {
    if (getMarkerFilename(resourceType)) {
      boundaryCache.set(resourceType, buildMarkerBoundaries(paths, resourceType));
    }
  }

  // Step 3: Classify each path
  for (const file of files) {
    const marker = getMarkerFilename(file.resourceType);

    // Marker enforcement: for marker-based types (e.g. skill with SKILL.md),
    // only classify files that are the marker itself or fall within a known
    // marker boundary. Orphan files (no marker nearby) are excluded.
    if (marker) {
      const def = getResourceTypeDef(file.resourceType);
      const categoryDir = def.dirName;
      if (categoryDir) {
        const pathUnder = getPathUnderCategory(file.path, categoryDir);
        if (pathUnder !== null) {
          const pathBasename = pathUnder.split('/').pop() ?? '';
          const isMarkerFile = pathBasename === marker;
          const boundaries = boundaryCache.get(file.resourceType) ?? [];
          const withinBoundary = boundaries.some(
            b => pathUnder === b || pathUnder.startsWith(b + '/')
          );
          if (!isMarkerFile && !withinBoundary) {
            continue; // orphan file — skip
          }
        }
      }
    }

    const boundaries = boundaryCache.get(file.resourceType);
    const fullName = boundaries && boundaries.length > 0
      ? deriveMarkerFullName(file.path, file.resourceType, boundaries)
      : deriveResourceFullName(file.path, file.resourceType);
    const resourceName = extractResourceName(fullName, file.resourceType);

    result.set(file.path, { resourceType: file.resourceType, resourceName, fullName });
  }

  return result;
}

/**
 * Classify untracked files and group them by resource key.
 *
 * Combines `classifyUntrackedPaths` with the iterate-and-group pattern that
 * both `resource-builder.ts` and `scope-data-collector.ts` duplicate. Orphan
 * files (skipped by marker enforcement in `classifyUntrackedPaths`) are
 * automatically excluded.
 *
 * @param files - Untracked files with workspace-relative paths and scanner categories
 * @returns Map from `"resourceType::resourceName"` to grouped resource info
 */
export function classifyAndGroupUntrackedFiles(
  files: Array<{ workspacePath: string; category: string }>
): Map<string, GroupedUntrackedResource> {
  if (files.length === 0) return new Map();

  const classified = classifyUntrackedPaths(
    files.map(f => ({
      path: f.workspacePath,
      resourceType: normalizeType(f.category),
    }))
  );

  const grouped = new Map<string, GroupedUntrackedResource>();

  for (const file of files) {
    const cls = classified.get(file.workspacePath);
    if (!cls) continue; // orphan — skipped by marker enforcement

    const key = `${cls.resourceType}::${cls.resourceName}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        resourceType: cls.resourceType,
        resourceName: cls.resourceName,
        fullName: cls.fullName,
        filePaths: [],
      });
    }
    grouped.get(key)!.filePaths.push(file.workspacePath);
  }

  return grouped;
}
