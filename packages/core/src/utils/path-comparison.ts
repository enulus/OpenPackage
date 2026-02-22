/**
 * Path Comparison Utilities
 * 
 * Provides path-aware comparison with support for:
 * - Tilde expansion (~/)
 * - Path normalization
 * - Glob pattern matching
 * - Cross-platform compatibility
 */

import * as path from 'path';
import * as os from 'os';
import { minimatch } from 'minimatch';

/**
 * Check if a string looks like a filesystem path
 */
export function isPathLike(value: any): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  // Check for common path patterns
  return (
    value.includes('/') ||           // Unix-style path
    value.includes('\\') ||          // Windows-style path
    value.startsWith('~') ||         // Home directory reference
    value.match(/^[A-Za-z]:/) !== null  // Windows drive letter
  );
}

/**
 * Expand tilde (~) to home directory
 */
export function expandTilde(filepath: string): string {
  if (!filepath) {
    return filepath;
  }

  if (filepath === '~') {
    return os.homedir();
  }

  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }

  return filepath;
}

/**
 * Check if a pattern contains glob characters
 */
export function hasGlobChars(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

/**
 * Compare two paths with support for:
 * - Tilde expansion
 * - Path normalization
 * - Glob pattern matching
 * 
 * @param value - The actual path value to test
 * @param pattern - The pattern to match against (can include globs)
 * @returns true if the paths match
 */
export function comparePathsWithGlobSupport(value: string, pattern: string): boolean {
  // Expand tildes in both paths
  const expandedValue = expandTilde(value);
  const expandedPattern = expandTilde(pattern);

  // Normalize paths to handle . and .. correctly
  const normalizedValue = path.normalize(expandedValue);
  const normalizedPattern = path.normalize(expandedPattern);

  // If pattern contains glob characters, use minimatch
  if (hasGlobChars(normalizedPattern)) {
    return minimatch(normalizedValue, normalizedPattern, {
      dot: true,              // Match dotfiles
      nocase: process.platform === 'win32'  // Case-insensitive on Windows
    });
  }

  // Otherwise do exact string comparison
  // On Windows, normalize case for comparison
  if (process.platform === 'win32') {
    return normalizedValue.toLowerCase() === normalizedPattern.toLowerCase();
  }

  return normalizedValue === normalizedPattern;
}

/**
 * Smart equality comparison with automatic path handling
 * 
 * If either value looks like a path, uses path-aware comparison.
 * Otherwise, uses standard equality.
 * 
 * @param left - Left operand
 * @param right - Right operand
 * @returns true if values are equal
 */
export function smartEquals(left: any, right: any): boolean {
  // If either looks like a path, use path comparison
  if (isPathLike(left) || isPathLike(right)) {
    // Convert both to strings for path comparison
    const leftStr = String(left);
    const rightStr = String(right);
    return comparePathsWithGlobSupport(leftStr, rightStr);
  }

  // Standard equality
  return left === right;
}

/**
 * Smart inequality comparison with automatic path handling
 * 
 * @param left - Left operand
 * @param right - Right operand
 * @returns true if values are not equal
 */
export function smartNotEquals(left: any, right: any): boolean {
  return !smartEquals(left, right);
}
