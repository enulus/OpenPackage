/**
 * Platform File Utilities
 * Shared utilities for handling platform-specific file paths and extensions
 */

import { basename, join } from 'path';
import type { Platform } from '../types/platform.js';
import {
  getPlatformDefinition,
  getAllPlatforms,
  getPlatformsState,
  isPlatformId
} from '../core/platforms.js';
import { DIR_PATTERNS, FILE_PATTERNS, type UniversalSubdir } from '../constants/index.js';
import { getFirstPathComponent, parsePathWithPrefix, normalizePathForProcessing } from './path-normalization.js';
import { mapUniversalToPlatform } from './platform-mapper.js';

/**
 * Parse a registry or universal path to extract subdir and relative path info
 * Platform suffix detection is always enabled and supports both file-level and directory-level suffixes.
 * @param path - The registry path from package files or universal path
 * @param options - Parsing options (allowPlatformSuffix is always true, kept for backward compatibility)
 * @returns Parsed information or null if not a universal subdir path
 */
export function parseUniversalPath(
  path: string,
  options: { allowPlatformSuffix?: boolean; cwd?: string } = {}
): { universalSubdir: string; relPath: string; platformSuffix?: string } | null {
  // Check if path starts with universal subdirs (dynamically discovered)
  const state = getPlatformsState(options.cwd ?? null);
  const universalSubdirs = state.universalSubdirs;
  const knownPlatforms = getAllPlatforms({ includeDisabled: true }) as readonly Platform[];
  const normalized = normalizePathForProcessing(path);
  const withoutPrefix = normalized; // Strict v2: do not strip legacy .openpackage/ prefix

  for (const subdir of universalSubdirs) {
    const parsed = parsePathWithPrefix(withoutPrefix, subdir);
    if (parsed) {
      const remainingPath = parsed.remaining;
      let platformSuffix: string | undefined;
      let normalizedRelPath = remainingPath;

      // Platform suffix detection is always enabled (options.allowPlatformSuffix defaults to true)
      if (options.allowPlatformSuffix !== false) {
        // Check for directory-level platform suffix (e.g., commands/foo.cursor/bar.md)
        const segments = remainingPath.split('/');
        for (let i = 0; i < segments.length - 1; i++) {
          const segment = segments[i];
          for (const platform of knownPlatforms) {
            if (segment.endsWith(`.${platform}`) && isPlatformId(platform)) {
              platformSuffix = platform;
              // Remove platform suffix from directory name for normalized path
              segments[i] = segment.slice(0, -platform.length - 1);
              normalizedRelPath = segments.join('/');
              break;
            }
          }
          if (platformSuffix) break;
        }

        // Check for file-level platform suffix (e.g., auth.cursor.md) if not already found
        if (!platformSuffix) {
          const parts = remainingPath.split('.');
          if (parts.length >= 3 && parts[parts.length - 1] === 'md') {
            // Check if the second-to-last part is a known platform
            const possiblePlatformSuffix = parts[parts.length - 2];
            if (isPlatformId(possiblePlatformSuffix)) {
              platformSuffix = possiblePlatformSuffix;
              // Remove platform suffix from filename
              const baseName = parts.slice(0, -2).join('.');
              normalizedRelPath = baseName + FILE_PATTERNS.MD_FILES;
            }
          }
        }
      }

      return {
        universalSubdir: subdir,
        relPath: normalizedRelPath,
        platformSuffix
      };
    }
  }

  return null;
}

/**
 * Get platform-specific filename for a universal path
 * Converts universal paths like "rules/auth.md" to platform-specific names like "auth.mdc"
 * @param universalPath - Universal path like "rules/auth.md"
 * @param platform - Target platform
 * @returns Platform-specific filename like "auth.mdc"
 */
export function getPlatformSpecificFilename(universalPath: string, platform: Platform, cwd?: string): string {
  const universalSubdir = getFirstPathComponent(universalPath);
  const registryFileName = basename(universalPath);

  const platformDef = getPlatformDefinition(platform, cwd);
  
  // TODO: Use export flows to determine extension transformation
  // For now, check export flows for extension mappings (package → workspace)
  if (platformDef.export && platformDef.export.length > 0) {
    for (const flow of platformDef.export) {
      // Skip switch expressions
      if (typeof flow.from === 'object' && '$switch' in flow.from) {
        continue;
      }
      // Check if this flow matches the universal path
      // For array patterns, use the first pattern
      const fromPattern = Array.isArray(flow.from) ? flow.from[0] : flow.from;
      if (fromPattern.includes(universalSubdir)) {
        const toPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0];
        if (toPattern) {
          // Extract extension from 'to' pattern
          const toExtMatch = toPattern.match(/\.[^./]+$/);
          const fromExtMatch = fromPattern.match(/\.[^./]+$/);
          
          if (toExtMatch && fromExtMatch) {
            // Extension transformation found
            const fromExt = fromExtMatch[0];
            const toExt = toExtMatch[0];
            
            if (registryFileName.endsWith(fromExt)) {
              return registryFileName.slice(0, -fromExt.length) + toExt;
            }
          }
        }
      }
    }
  }

  // No transformation found, return original filename
  return registryFileName;
}

/**
 * Get platform-specific file path information (full paths with directories)
 * Wrapper around existing platform-mapper utilities for convenience
 * @param cwd - Current working directory
 * @param universalSubdir - Universal subdirectory
 * @param relPath - Relative path within the subdir
 * @param platform - Target platform
 * @returns Object with absolute directory and file paths
 */
export async function getPlatformSpecificPath(
  cwd: string,
  universalSubdir: string,
  relPath: string,
  platform: Platform
): Promise<{ absDir: string; absFile: string }> {
  // Get the mapping
  const { relDir, relFile } = mapUniversalToPlatform(platform, universalSubdir, relPath, cwd);

  // Convert relative paths to absolute paths
  return {
    absDir: join(cwd, relDir),
    absFile: join(cwd, relFile)
  };
}
