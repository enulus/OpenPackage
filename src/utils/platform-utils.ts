/**
 * Platform Utilities Module
 * Utility functions for platform management, detection, and file operations
 */

import { join } from 'path';
import { getPathLeaf } from './path-normalization.js';
import { FILE_PATTERNS } from '../constants/index.js';
import {
  getAllPlatforms,
  getAllRootFiles,
  getPlatformDefinition,
  getPlatformDirLookup,
  type Platform,
  type PlatformDetectionResult,
  detectAllPlatforms
} from '../core/platforms.js';

/* Removed unused detectPlatformsWithDetails - use detectAllPlatforms directly for details */

/**
 * Extract platform name from source directory path
 * Uses platform definitions for scalable platform detection
 * @param cwd - Optional cwd for local platform config overrides
 */
export function getPlatformNameFromSource(sourceDir: string, cwd?: string): string {
  // Quick lookup via dir map first
  const dirLookup = getPlatformDirLookup(cwd);
  const fromDir = dirLookup[sourceDir];
  if (fromDir) return fromDir;

  // Full scan for subdir matches
  for (const platform of getAllPlatforms({ includeDisabled: true }, cwd)) {
    const definition = getPlatformDefinition(platform, cwd);
    for (const [subdirName, subdirDef] of Object.entries(definition.subdirs)) {
      const subdirPath = join(definition.rootDir, subdirDef.path);
      if (sourceDir.includes(subdirPath)) {
        return platform;
      }
    }
  }

  // Fallback: extract from path
  return getPathLeaf(sourceDir) || 'unknown';
}

/**
 * Get all platform directory names
 * Returns an array of all supported platform directory names
 * @param cwd - Optional cwd for local overrides
 */
export function getAllPlatformDirs(cwd?: string): string[] {
  return Object.keys(getPlatformDirLookup(cwd));
}

/**
 * Get all platform root files as a Set, including AGENTS.md universal file.
 * @param cwd - Optional cwd for local overrides
 */
export function getPlatformRootFiles(cwd?: string): Set<string> {
  const rootFiles = new Set(getAllRootFiles(cwd));  // from platforms.ts, excludes AGENTS.md
  rootFiles.add(FILE_PATTERNS.AGENTS_MD);
  return rootFiles;
}

export function isPlatformRootFile(fileName: string, cwd?: string): boolean {
  return getPlatformRootFiles(cwd).has(fileName);
}



