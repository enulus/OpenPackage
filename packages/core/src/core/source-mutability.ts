import path from 'path';
import { getRegistryDirectories } from './directory.js';
import { INDEX_SOURCE_TYPES, type IndexSourceType } from '../constants/index.js';

export function isRegistryPath(absPath: string): boolean {
  const registryRoot = getRegistryDirectories().packages;
  const resolvedRegistry = path.resolve(registryRoot);
  const resolvedTarget = path.resolve(absPath);

  const relativePath = path.relative(resolvedRegistry, resolvedTarget);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

/**
 * Check if a path is inside a git cache (.openpackage/cache/git/).
 * Uses forward-slash normalization to handle both Unix and Windows paths.
 */
export function isGitCachePath(absPath: string): boolean {
  const normalized = absPath.replace(/\\/g, '/');
  // Match /.openpackage/cache/git/ preceded by start-of-string or another path segment
  return /(?:^|\/)\.openpackage\/cache\/git\//.test(normalized);
}

/**
 * Classify a resolution source type and absolute path into an IndexSourceType.
 *
 * Logic:
 * - git resolution -> 'git'
 * - registry resolution -> 'registry'
 * - path under ~/.openpackage/packages/ -> 'global'
 * - otherwise -> 'project'
 */
export function classifyIndexSourceType(
  resolutionSourceType: 'registry' | 'path' | 'git',
  absolutePath: string
): IndexSourceType {
  if (resolutionSourceType === 'git') return INDEX_SOURCE_TYPES.GIT;

  if (resolutionSourceType === 'registry') return INDEX_SOURCE_TYPES.REGISTRY;

  // Path source — distinguish project vs global
  if (isGitCachePath(absolutePath)) return INDEX_SOURCE_TYPES.GIT;
  if (isRegistryPath(absolutePath)) return INDEX_SOURCE_TYPES.REGISTRY;

  const normalized = absolutePath.replace(/\\/g, '/');
  // Check for global packages dir (~/.openpackage/packages/)
  if (normalized.includes('/.openpackage/packages/') || normalized.includes('.openpackage/packages/')) {
    // Could be project-local (.openpackage/packages/) or global (~/.openpackage/packages/)
    // If it's under the user home dir's .openpackage/packages/ -> global
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const normalizedHome = homeDir.replace(/\\/g, '/');
    if (normalizedHome && normalized.startsWith(normalizedHome + '/.openpackage/packages/')) {
      return INDEX_SOURCE_TYPES.GLOBAL;
    }
  }

  return INDEX_SOURCE_TYPES.PROJECT;
}

/**
 * Determine mutability from a stored index source type and/or absolute path.
 * Prefers the explicit sourceType when available; falls back to path inference.
 */
export function classifyMutability(
  sourceType: 'project' | 'global' | 'registry' | 'git' | undefined,
  absolutePath: string
): 'mutable' | 'immutable' {
  if (sourceType === 'registry' || sourceType === 'git') return 'immutable';
  if (sourceType) return 'mutable';
  // Legacy fallback: no stored sourceType
  if (isRegistryPath(absolutePath) || isGitCachePath(absolutePath)) return 'immutable';
  return 'mutable';
}

/**
 * Assert that a source path is mutable (not registry or git cache).
 * Throws with a source-type-specific error message if immutable.
 */
export function assertMutableSourceOrThrow(
  absPath: string,
  ctx: { packageName: string; command: string }
): void {
  if (isRegistryPath(absPath)) {
    throw new Error(
      `Package ${ctx.packageName} cannot run '${ctx.command}' because its source path is immutable (registry snapshot): ${absPath}. Use \`opkg add --project\` to create a mutable copy.`
    );
  }
  if (isGitCachePath(absPath)) {
    throw new Error(
      `Package ${ctx.packageName} cannot run '${ctx.command}' because its source path is immutable (git cache): ${absPath}. Fork the repository and install from your fork to enable sync.`
    );
  }
}
