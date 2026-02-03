/**
 * Canonical ID computation for dependency graph nodes.
 * Used for deduplication and cycle detection.
 */

import { resolve, dirname } from 'path';
import type { DependencyId, DependencyDeclaration } from './types.js';
import { resolveDeclaredPath } from '../../../utils/path-resolution.js';

/**
 * Normalize a git URL for stable canonical keys.
 * - Lowercase host and path
 * - Remove .git suffix
 * - Convert SSH to HTTPS form
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();
  // SSH: git@github.com:user/repo.git -> https://github.com/user/repo
  if (normalized.startsWith('git@')) {
    const match = normalized.match(/^git@([^:]+):(.+)$/);
    if (match) {
      const [, host, pathPart] = match;
      normalized = `https://${host}/${pathPart}`;
    }
  }
  normalized = normalized.toLowerCase();
  if (normalized.endsWith('.git')) {
    normalized = normalized.slice(0, -4);
  }
  return normalized;
}

/**
 * Compute canonical dependency ID from a declaration.
 * declaredInDir should be the directory containing the manifest that declared this dependency
 * (e.g. dirname(declaration.declaredIn)).
 */
export function computeDependencyId(
  declaration: DependencyDeclaration,
  declaredInDir: string
): DependencyId {
  const depName = String(declaration.name ?? '').trim();

  if (declaration.url) {
    // Git source: normalize URL + ref + path
    const [gitUrlRaw, embeddedRef] = declaration.url.includes('#')
      ? declaration.url.split('#', 2)
      : [declaration.url, undefined];
    // Keep a stable key for "default branch" installs without forcing an invalid ref.
    // Using 'HEAD' here is problematic because some code paths would attempt
    // `git clone --branch HEAD`, which is not a real branch on many repos.
    const ref = embeddedRef || declaration.ref || 'default';
    const normalizedUrl = normalizeGitUrl(gitUrlRaw);
    // Resource path from name (gh@owner/repo/path) or from path field
    let resourcePath = declaration.path ?? '';
    if (depName.startsWith('gh@')) {
      const tail = depName.slice(3);
      const parts = tail.split('/').filter(Boolean);
      if (parts.length > 2) {
        resourcePath = resourcePath || parts.slice(2).join('/');
      }
    }
    const key = `git:${normalizedUrl}#${ref}:${resourcePath}`;
    const displayName = depName || (resourcePath ? `git@${normalizedUrl}/${resourcePath}` : `git@${normalizedUrl}`);
    return { key, displayName, sourceType: 'git' };
  }

  if (declaration.path) {
    // Path source: resolve to absolute path
    const { absolute } = resolveDeclaredPath(declaration.path, declaredInDir);
    const key = `path:${absolute}`;
    const displayName = depName || declaration.path;
    return { key, displayName, sourceType: 'path' };
  }

  // Registry source: name + version constraint
  const version = (declaration.version ?? '*').trim();
  const key = `registry:${depName}:${version}`;
  return { key, displayName: depName, sourceType: 'registry' };
}
