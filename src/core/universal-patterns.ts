/**
 * Universal Pattern Matching Module
 * 
 * Uses minimatch for reliable glob pattern matching
 */

import { minimatch } from 'minimatch';
import { normalizePathForProcessing } from '../utils/path-normalization.js';

/**
 * Check if a file path matches a glob pattern.
 */
export function isPatternMatch(filePath: string, pattern: string): boolean {
  const normalizedPath = normalizePathForProcessing(filePath);
  const normalizedPattern = normalizePathForProcessing(pattern);
  
  return minimatch(normalizedPath, normalizedPattern, {
    dot: false,        // Don't match dotfiles by default
    nocase: false,     // Case-sensitive matching
    matchBase: false,  // Don't match basename only
  });
}

/**
 * Check if a file path matches any pattern in a set of glob patterns.
 */
export function matchesAnyPattern(filePath: string, patterns: Set<string>): boolean {
  const normalized = normalizePathForProcessing(filePath);
  
  for (const pattern of patterns) {
    if (isPatternMatch(normalized, pattern)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract the first path component (directory or file) from a pattern or path.
 */
export function extractFirstComponent(pathOrPattern: string): string | null {
  const normalized = normalizePathForProcessing(pathOrPattern);
  if (!normalized) return null;
  
  const parts = normalized.split('/');
  return parts[0] || null;
}

/**
 * Check if a pattern represents a subdirectory (not a root-level file).
 */
export function isSubdirectoryPattern(pattern: string): boolean {
  const firstComponent = extractFirstComponent(pattern);
  return firstComponent !== null && !firstComponent.includes('.');
}

/**
 * Extract all subdirectory names from a set of patterns.
 */
export function extractSubdirectoriesFromPatterns(patterns: Set<string>): Set<string> {
  const subdirs = new Set<string>();
  
  for (const pattern of patterns) {
    if (isSubdirectoryPattern(pattern)) {
      const firstComponent = extractFirstComponent(pattern);
      if (firstComponent) {
        subdirs.add(firstComponent);
      }
    }
  }
  
  return subdirs;
}
