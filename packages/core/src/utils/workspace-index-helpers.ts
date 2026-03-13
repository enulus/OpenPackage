/**
 * Helper functions for working with workspace index file mappings
 */

import type { WorkspaceIndexFileMapping, WorkspaceIndexPackage } from '../types/workspace-index.js';
import { arePackageNamesEquivalent, normalizePackageNameForLookup } from './package-name.js';
import { classifyResourceSpec } from '../core/resources/resource-spec.js';
import { isQualifiedName } from './qualified-name.js';

/**
 * Extract target path from a mapping (handles both string and object forms)
 */
export function getTargetPath(mapping: string | WorkspaceIndexFileMapping): string {
  return typeof mapping === 'string' ? mapping : mapping.target;
}

/**
 * Check if a mapping is complex (has key tracking)
 */
export function isComplexMapping(mapping: string | WorkspaceIndexFileMapping): mapping is WorkspaceIndexFileMapping {
  return typeof mapping !== 'string';
}

/**
 * Check if a mapping represents a merged file (multiple packages contributing to one target)
 */
export function isMergedMapping(
  mapping: string | WorkspaceIndexFileMapping
): mapping is WorkspaceIndexFileMapping {
  return (
    typeof mapping !== 'string' &&
    !!mapping.merge &&
    Array.isArray(mapping.keys) &&
    mapping.keys.length > 0
  );
}

/**
 * Extract all target paths from file mappings
 */
export function extractAllTargetPaths(
  files: Record<string, (string | WorkspaceIndexFileMapping)[]>
): string[] {
  const paths: string[] = [];

  for (const mappings of Object.values(files)) {
    for (const mapping of mappings) {
      paths.push(getTargetPath(mapping));
    }
  }

  return paths;
}

/**
 * Find a package in the workspace index using multi-strategy fallback:
 * 1. Exact key match
 * 2. Case-insensitive equivalence
 * 3. Old→new format normalization (@scope/repo → gh@scope/repo)
 * 4. Resource name match (e.g. "skills/skill-creator" matches package with source keys starting with "skills/skill-creator/")
 */
export function findPackageInIndex(
  input: string,
  packages: Record<string, WorkspaceIndexPackage>,
): { key: string; entry: WorkspaceIndexPackage } | null {
  // 1. Exact key match
  if (packages[input]) {
    return { key: input, entry: packages[input] };
  }

  // 2. Case-insensitive equivalence
  for (const key of Object.keys(packages)) {
    if (arePackageNamesEquivalent(key, input)) {
      return { key, entry: packages[key] };
    }
  }

  // 2.5. Unambiguous child lookup: if input is NOT qualified, check for any qualified key
  // ending with /<input> — return if exactly one match (unambiguous).
  if (!isQualifiedName(input)) {
    const suffix = '/' + input.toLowerCase();
    const qualifiedMatches: { key: string; entry: WorkspaceIndexPackage }[] = [];
    for (const [key, entry] of Object.entries(packages)) {
      if (isQualifiedName(key) && key.toLowerCase().endsWith(suffix)) {
        qualifiedMatches.push({ key, entry });
      }
    }
    if (qualifiedMatches.length === 1) {
      return qualifiedMatches[0];
    }
    // If multiple matches, fall through (ambiguous — user must qualify)
  }

  // 3. Old→new format normalization
  const normalized = normalizePackageNameForLookup(input);
  if (normalized !== input.toLowerCase()) {
    if (packages[normalized]) {
      return { key: normalized, entry: packages[normalized] };
    }
    for (const key of Object.keys(packages)) {
      if (arePackageNamesEquivalent(key, normalized)) {
        return { key, entry: packages[key] };
      }
    }
  }

  // 4. Resource name match — only if input looks like a resource ref (e.g. "skills/skill-creator")
  const spec = classifyResourceSpec(input);
  if (spec.kind === 'resource-ref') {
    const inputWithSlash = input + '/';
    for (const [key, entry] of Object.entries(packages)) {
      const files = entry.files;
      if (!files) continue;
      for (const sourceKey of Object.keys(files)) {
        if (sourceKey.startsWith(inputWithSlash) || sourceKey === input) {
          return { key, entry };
        }
      }
    }
  }

  return null;
}
