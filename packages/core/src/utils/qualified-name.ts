/**
 * Qualified Name Utilities
 *
 * Single source of truth for all qualified name logic used by the nested
 * packages feature. A qualified name takes the form `parent/child` and
 * identifies an embedded sub-package within a parent package.
 */

import type { WorkspaceIndexPackage } from '../types/workspace-index.js';

/**
 * Check if a name is a qualified (parent/child) name.
 *
 * Rules:
 * - Contains exactly one `/`
 * - Does NOT start with `@` (scoped npm names)
 * - Does NOT start with `gh@` (GitHub shorthand)
 * - Does NOT start with `.`, `/`, or `~` (path prefixes)
 * - Is not empty on either side of the `/`
 */
export function isQualifiedName(name: string): boolean {
  if (!name || !name.includes('/')) return false;

  // Exclude scoped npm names (@scope/name)
  if (name.startsWith('@')) return false;

  // Exclude GitHub shorthand (gh@owner/repo)
  if (name.startsWith('gh@')) return false;

  // Exclude path prefixes
  if (name.startsWith('.') || name.startsWith('/') || name.startsWith('~')) return false;

  const parts = name.split('/');
  // Exactly two non-empty segments
  if (parts.length !== 2) return false;
  if (!parts[0] || !parts[1]) return false;

  return true;
}

/**
 * Parse a qualified name into parent and child components.
 * Returns null if the name is not a valid qualified name.
 */
export function parseQualifiedName(name: string): { parent: string; child: string } | null {
  if (!isQualifiedName(name)) return null;

  const slashIndex = name.indexOf('/');
  return {
    parent: name.slice(0, slashIndex),
    child: name.slice(slashIndex + 1),
  };
}

/**
 * Build a qualified name from parent and child components.
 */
export function buildQualifiedName(parent: string, child: string): string {
  return `${parent}/${child}`;
}

/**
 * Get the parent name from a qualified name, or null if not qualified.
 */
export function getParentName(qualifiedName: string): string | null {
  const parsed = parseQualifiedName(qualifiedName);
  return parsed?.parent ?? null;
}

/**
 * Get all embedded children of a parent package from the index.
 * Returns an array of qualified keys whose `parent` field matches the parent name.
 */
export function getEmbeddedChildren(
  packages: Record<string, WorkspaceIndexPackage>,
  parentName: string
): string[] {
  const children: string[] = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (entry.parent === parentName) {
      children.push(key);
    }
  }
  return children;
}
