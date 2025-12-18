import { normalizeRegistryPath } from './registry-entry-filter.js';
import { DIR_PATTERNS } from '../constants/index.js';
import { getAllUniversalSubdirs } from '../core/platforms.js';

/**
 * Commander option parser for comma-separated registry paths.
 * Ensures the pipeline always receives a normalized string[].
 */
export function parsePathsOption(value?: string): string[] {
  if (!value) {
    return [];
  }
  return normalizeRegistryPaths(value.split(','));
}

/**
 * Normalize an array of registry paths:
 * - trim whitespace
 * - drop empties
 * - strip leading slash
 * - normalize to registry format
 * - dedupe
 */
export function normalizeRegistryPaths(rawPaths: string[]): string[] {
  const normalized = rawPaths
    .filter(path => typeof path === 'string')
    .map(path => path.trim())
    .filter(path => path.length > 0)
    .map(path => (path.startsWith('/') ? path.slice(1) : path))
    .map(path => normalizeRegistryPath(path))
    .filter(path => path.length > 0);

  return Array.from(new Set(normalized));
}

/**
 * Combine option-provided paths with a spec-provided path (e.g. pkg@ver/path).
 */
export function buildRequestedPaths(
  optionPaths: string[] | undefined,
  specPath: string | undefined
): string[] {
  return normalizeRegistryPaths([
    ...(optionPaths ?? []),
    ...(specPath ? [specPath] : [])
  ]);
}

export function formatRegistryPathForDisplay(registryPath: string, cwd?: string): string {
  const universalSubdirs = getAllUniversalSubdirs(cwd);
  const firstComponent = registryPath.split('/')[0];

  if (firstComponent && universalSubdirs.has(firstComponent)) {
    return `${DIR_PATTERNS.OPENPACKAGE}/${registryPath}`;
  }

  return registryPath;
}


