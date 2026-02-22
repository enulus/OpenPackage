/**
 * Platform Root Files Utilities
 * Shared utilities for collecting and working with platform root file names
 */

import { FILE_PATTERNS, PACKAGE_ROOT_DIRS } from '../constants/index.js';
import type { Platform } from '../types/platform.js';
import { getPlatformDefinition } from '../core/platforms.js';

/**
 * Get all platform root file names (including universal AGENTS.md) for the given platforms.
 * @param platforms - Array of platforms to collect root files from
 * @param targetDir - Optional target directory for platform config overrides
 * @returns Set of root file names
 */
export function getPlatformRootFileNames(platforms: Platform[], targetDir?: string): Set<string> {
  const names = new Set<string>([FILE_PATTERNS.AGENTS_MD]);
  for (const platform of platforms) {
    const def = getPlatformDefinition(platform, targetDir);
    if (def.rootFile) {
      names.add(def.rootFile);
    }
  }
  return names;
}

/**
 * Strip the root copy prefix from a path if it starts with `root/`.
 * @param path - Path that may start with `root/`
 * @returns Path with `root/` prefix stripped, or original path if it doesn't start with `root/`
 */
export function stripRootCopyPrefix(path: string): string | null {
  const prefix = `${PACKAGE_ROOT_DIRS.ROOT_COPY}/`;
  if (path.startsWith(prefix)) {
    const stripped = path.slice(prefix.length);
    return stripped.length > 0 ? stripped : null;
  }
  return null;
}

/**
 * Check if a path is a root copy path (starts with `root/`).
 * @param path - Path to check
 * @returns True if path starts with `root/`
 */
export function isRootCopyPath(path: string): boolean {
  return path.startsWith(`${PACKAGE_ROOT_DIRS.ROOT_COPY}/`);
}
