/**
 * Package Marker Detector Module
 * 
 * Detects package-level format markers using patterns from platforms.jsonc.
 * This is the "fast path" for package format detection.
 * 
 * All platform IDs and detection patterns are data-driven from platforms.jsonc -
 * no hardcoded platform checks.
 */

import { minimatch } from 'minimatch';
import { logger } from '../../utils/logger.js';
import { getPlatformDefinitions } from '../platforms.js';
import type { PackageFile, PlatformId } from './detection-types.js';

/**
 * A matched platform marker
 */
export interface MarkerMatch {
  /** Platform ID from platforms.jsonc (e.g., 'claude', 'cursor', 'opencode') */
  platformId: PlatformId;
  
  /** Detection pattern that matched (e.g., '.claude-plugin/plugin.json') */
  matchedPattern: string;
  
  /** Confidence (1.0 for explicit markers) */
  confidence: number;
}

/**
 * Package marker detection result
 */
export interface PackageMarkers {
  /** All matched platform markers */
  matches: MarkerMatch[];
  
  /** Whether openpackage.yml exists (universal format indicator) */
  hasOpenPackageYml: boolean;
  
  /** Whether package.yml exists (legacy universal format) */
  hasPackageYml: boolean;
}

/**
 * Detect platform markers in a package using patterns from platforms.jsonc
 * 
 * This is a data-driven approach - all platform IDs and detection patterns
 * come from the platform registry, with no hardcoded platform checks.
 * 
 * @param files - List of package files
 * @param targetDir - Optional target directory for local platform config
 * @returns Detection results with all matched platforms
 */
export function detectPlatformMarkers(
  files: PackageFile[],
  targetDir?: string
): PackageMarkers {
  const matches: MarkerMatch[] = [];
  const platforms = getPlatformDefinitions(targetDir);
  
  // Extract file paths for efficient matching
  const filePaths = new Set(files.map(f => f.path));
  
  // Check each platform's detection patterns
  for (const [platformId, definition] of Object.entries(platforms)) {
    const detectionPatterns = definition.detection;
    
    if (!detectionPatterns || detectionPatterns.length === 0) {
      continue;
    }
    
    // Check each detection pattern for this platform
    for (const pattern of detectionPatterns) {
      if (matchDetectionPattern(filePaths, pattern)) {
        matches.push({
          platformId,
          matchedPattern: pattern,
          confidence: 1.0
        });
      }
    }
  }
  
  // Check for universal format markers
  const hasOpenPackageYml = filePaths.has('openpackage.yml');
  const hasPackageYml = filePaths.has('package.yml');
  
  return {
    matches,
    hasOpenPackageYml,
    hasPackageYml
  };
}

/**
 * Check if a detection pattern matches any file in the package
 * 
 * Handles both exact file paths and glob patterns.
 * 
 * @param filePaths - Set of file paths in package
 * @param pattern - Detection pattern (e.g., '.claude', '*.json', 'AGENTS.md')
 * @returns True if pattern matches at least one file
 */
export function matchDetectionPattern(
  filePaths: Set<string>,
  pattern: string
): boolean {
  // Try exact match first (optimization for non-glob patterns)
  if (filePaths.has(pattern)) {
    return true;
  }
  
  // Check if pattern contains glob characters
  const isGlob = pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
  
  if (isGlob) {
    // Use glob matching
    for (const filePath of filePaths) {
      if (matchGlob(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }
  
  // For non-glob patterns, check if any file starts with this path
  // This handles directory markers like '.claude' matching '.claude/agents/foo.md'
  for (const filePath of filePaths) {
    if (filePath === pattern || filePath.startsWith(pattern + '/')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Match a file path against a glob pattern
 */
function matchGlob(filePath: string, pattern: string): boolean {
  try {
    return minimatch(filePath, pattern);
  } catch (error) {
    logger.warn(`Invalid glob pattern: ${pattern}`, error);
    return false;
  }
}

/**
 * Check if openpackage.yml or package.yml exists
 * 
 * These files indicate universal format but don't prevent per-file detection
 * (the package may still contain mixed platform-specific content).
 */
export function hasOpenPackageMarker(files: PackageFile[]): boolean {
  return files.some(f => f.path === 'openpackage.yml' || f.path === 'package.yml');
}

/**
 * Get primary platform from marker matches
 * 
 * Determines the primary platform when multiple markers are found.
 * Uses priority ordering to resolve ambiguity.
 * 
 * @param markers - Package marker detection results
 * @returns Primary platform ID, or null if none/ambiguous
 */
export function getPrimaryPlatformFromMarkers(
  markers: PackageMarkers
): PlatformId | null {
  const { matches, hasOpenPackageYml, hasPackageYml } = markers;
  
  // No matches
  if (matches.length === 0) {
    return null;
  }
  
  // Single match - return that platform
  if (matches.length === 1) {
    return matches[0].platformId;
  }
  
  // Multiple matches - use priority
  // Priority order (highest to lowest):
  // 1. claude-plugin (explicit plugin manifest)
  // 2. Other platforms by detection pattern specificity
  
  // Check for claude-plugin first
  const claudePluginMatch = matches.find(m => m.platformId === 'claude-plugin');
  if (claudePluginMatch) {
    return 'claude-plugin';
  }
  
  // For other platforms, prefer more specific patterns (longer paths)
  const sorted = [...matches].sort((a, b) => 
    b.matchedPattern.length - a.matchedPattern.length
  );
  
  return sorted[0].platformId;
}

/**
 * Check if markers indicate a pure platform-specific package
 * 
 * A pure platform-specific package has:
 * - Exactly one platform marker
 * - No universal format marker (openpackage.yml)
 * 
 * @param markers - Package marker detection results
 * @returns True if package is pure platform-specific
 */
export function isPurePlatformSpecific(markers: PackageMarkers): boolean {
  const { matches, hasOpenPackageYml, hasPackageYml } = markers;
  
  // Must have exactly one platform match
  if (matches.length !== 1) {
    return false;
  }
  
  // Must not have universal markers
  if (hasOpenPackageYml || hasPackageYml) {
    return false;
  }
  
  return true;
}

/**
 * Check if markers indicate a mixed format package
 * 
 * A mixed format package has either:
 * - Multiple platform markers
 * - Both platform and universal markers
 * 
 * @param markers - Package marker detection results
 * @returns True if package has mixed format indicators
 */
export function isMixedFormat(markers: PackageMarkers): boolean {
  const { matches, hasOpenPackageYml, hasPackageYml } = markers;
  
  // Multiple platform markers
  if (matches.length > 1) {
    return true;
  }
  
  // Platform marker + universal marker
  if (matches.length > 0 && (hasOpenPackageYml || hasPackageYml)) {
    return true;
  }
  
  return false;
}
