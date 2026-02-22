/**
 * Platform Suffix Handler
 * 
 * Handles platform-specific file suffix detection and manipulation.
 * Supports naming conventions like:
 * - mcp.claude.jsonc (root-level platform-specific file)
 * - commands/test.claude.md (universal subdir with platform suffix)
 */

import { basename, dirname, join } from 'path';
import type { Platform } from '../platforms.js';
import { getAllPlatforms, isPlatformId } from '../platforms.js';
import { parseUniversalPath } from '../../utils/platform-file.js';

/**
 * Extract platform suffix from filename
 * 
 * @param filename - Filename or path to check
 * @returns Platform ID if suffix found, null otherwise
 * 
 * @example
 * extractPlatformSuffixFromFilename('mcp.claude.jsonc') // => 'claude'
 * extractPlatformSuffixFromFilename('commands/test.cursor.md') // => 'cursor'
 * extractPlatformSuffixFromFilename('mcp.jsonc') // => null
 */
export function extractPlatformSuffixFromFilename(filename: string): string | null {
  const baseName = basename(filename);
  const parts = baseName.split('.');
  
  // Need at least 3 parts: name.platform.ext
  if (parts.length >= 3) {
    const possiblePlatform = parts[parts.length - 2];
    if (isPlatformId(possiblePlatform)) {
      return possiblePlatform;
    }
  }
  
  return null;
}

/**
 * Strip platform suffix from filename
 * 
 * @param filename - Filename or path to process
 * @returns Filename with platform suffix removed
 * 
 * @example
 * stripPlatformSuffixFromFilename('mcp.claude.jsonc') // => 'mcp.jsonc'
 * stripPlatformSuffixFromFilename('commands/test.cursor.md') // => 'commands/test.md'
 * stripPlatformSuffixFromFilename('mcp.jsonc') // => 'mcp.jsonc' (unchanged)
 */
export function stripPlatformSuffixFromFilename(filename: string): string {
  const platformSuffix = extractPlatformSuffixFromFilename(filename);
  if (!platformSuffix) {
    return filename;
  }
  
  const dir = dirname(filename);
  const baseName = basename(filename);
  const parts = baseName.split('.');
  
  // Remove platform suffix (second-to-last part)
  const strippedParts = [...parts.slice(0, -2), parts[parts.length - 1]];
  const strippedBaseName = strippedParts.join('.');
  
  return dir === '.' ? strippedBaseName : join(dir, strippedBaseName);
}

/**
 * Build a map of base paths to platforms that have override files
 * 
 * This is used to determine when universal files should be skipped because
 * platform-specific overrides exist.
 * 
 * @param sources - Array of source file paths
 * @returns Map of base path to Set of platforms with overrides
 * 
 * @example
 * // Input: ['commands/test.md', 'commands/test.claude.md', 'mcp.jsonc', 'mcp.cursor.jsonc']
 * // Output: Map {
 * //   'commands/test.md' => Set(['claude']),
 * //   'mcp.jsonc' => Set(['cursor'])
 * // }
 */
export function buildOverrideMap(sources: string[]): Map<string, Set<Platform>> {
  const overridesByBasePath = new Map<string, Set<Platform>>();
  
  for (const sourceRel of sources) {
    const parsed = parseUniversalPath(sourceRel, { allowPlatformSuffix: true });
    const platformSuffix = parsed?.platformSuffix || extractPlatformSuffixFromFilename(sourceRel);
    
    if (platformSuffix) {
      // For universal subdir files, use the parsed baseKey
      // For root-level files, use the stripped filename as the baseKey
      const baseKey = parsed 
        ? `${parsed.universalSubdir}/${parsed.relPath}`
        : stripPlatformSuffixFromFilename(sourceRel);
      
      if (!overridesByBasePath.has(baseKey)) {
        overridesByBasePath.set(baseKey, new Set());
      }
      overridesByBasePath.get(baseKey)!.add(platformSuffix as Platform);
    }
  }
  
  return overridesByBasePath;
}

/**
 * Check if a universal file should be skipped due to platform-specific override
 * 
 * @param sourceRel - Source file path (relative)
 * @param targetPlatform - Target platform to check
 * @param sources - All source files (for building override map)
 * @param overrideMap - Pre-built override map (optional, for performance)
 * @returns True if file should be skipped
 */
export function shouldSkipUniversalFile(
  sourceRel: string,
  targetPlatform: Platform,
  sources: string[],
  overrideMap?: Map<string, Set<Platform>>
): boolean {
  // Parse to check if it's a universal subdir file
  const parsed = parseUniversalPath(sourceRel, { allowPlatformSuffix: true });
  
  // If file has platform suffix, it's not universal
  const platformSuffix = parsed?.platformSuffix || extractPlatformSuffixFromFilename(sourceRel);
  if (platformSuffix) {
    return false;
  }
  
  // Build override map if not provided
  const overrides = overrideMap || buildOverrideMap(sources);
  
  // Check for override
  if (parsed) {
    // Universal subdir file
    const baseKey = `${parsed.universalSubdir}/${parsed.relPath}`;
    const overridePlatforms = overrides.get(baseKey);
    return overridePlatforms?.has(targetPlatform) ?? false;
  } else {
    // Root-level file
    const strippedFileName = stripPlatformSuffixFromFilename(sourceRel);
    
    // Check if any file in sources is a platform-specific override for this file
    return sources.some(s => {
      const sSuffix = extractPlatformSuffixFromFilename(s);
      const sStripped = stripPlatformSuffixFromFilename(s);
      return sSuffix === targetPlatform && sStripped === strippedFileName;
    });
  }
}

/**
 * Check if a platform-specific file is for the target platform
 * 
 * @param sourceRel - Source file path (relative)
 * @param targetPlatform - Target platform to check
 * @returns True if file is for target platform
 */
export function isPlatformSpecificFileForTarget(
  sourceRel: string,
  targetPlatform: Platform
): boolean {
  const parsed = parseUniversalPath(sourceRel, { allowPlatformSuffix: true });
  const platformSuffix = parsed?.platformSuffix || extractPlatformSuffixFromFilename(sourceRel);
  
  if (!platformSuffix) {
    return false;
  }
  
  return platformSuffix === targetPlatform;
}

/**
 * Get all platform-specific variants of a file
 * 
 * @param baseFile - Base filename (without platform suffix)
 * @param sources - All source files
 * @returns Array of platform-specific variants
 * 
 * @example
 * getPlatformVariants('mcp.jsonc', ['mcp.jsonc', 'mcp.claude.jsonc', 'mcp.cursor.jsonc'])
 * // => ['mcp.claude.jsonc', 'mcp.cursor.jsonc']
 */
export function getPlatformVariants(
  baseFile: string,
  sources: string[]
): Array<{ platform: Platform; path: string }> {
  const variants: Array<{ platform: Platform; path: string }> = [];
  
  const baseStripped = stripPlatformSuffixFromFilename(baseFile);
  
  for (const source of sources) {
    const platformSuffix = extractPlatformSuffixFromFilename(source);
    if (platformSuffix) {
      const sourceStripped = stripPlatformSuffixFromFilename(source);
      if (sourceStripped === baseStripped) {
        variants.push({
          platform: platformSuffix as Platform,
          path: source
        });
      }
    }
  }
  
  return variants;
}

/**
 * Normalize a source path for canonical key generation
 * 
 * This handles the case where a dot-prefixed file (.mcp.json) is discovered
 * but the flow pattern array includes other patterns. Returns the canonical
 * form preferred for file mapping keys.
 * 
 * @param sourceRel - Source file path (relative)
 * @param flowPatterns - Flow patterns that could match
 * @param packageRoot - Package root directory
 * @returns Canonical source path
 */
export function normalizeSourceForMapping(
  sourceRel: string,
  flowPatterns: string | string[],
  packageRoot: string
): string {
  // If not a dot-prefixed root-level file, return as-is
  if (!sourceRel.startsWith('.') || sourceRel.includes('/')) {
    return sourceRel;
  }
  
  // Not an array pattern, return as-is
  if (!Array.isArray(flowPatterns)) {
    return sourceRel;
  }
  
  // For dot-prefixed files, prefer explicit pattern match over dot-prefix pattern
  // This prevents duplicate keys in file mapping
  const patterns = flowPatterns;
  
  for (const pattern of patterns) {
    // Skip dot-prefixed patterns and the current sourceRel
    if (pattern.startsWith('.') || pattern === sourceRel) {
      continue;
    }
    
    // Check if pattern could match this file
    // Simple heuristic: if stripping dot from sourceRel matches pattern structure
    const withoutDot = sourceRel.substring(1);
    if (withoutDot === pattern) {
      return pattern;
    }
  }
  
  return sourceRel;
}
