/**
 * Home Directory Utilities
 * 
 * Centralized module for all home directory operations.
 * Handles path resolution, comparison, and display normalization.
 */

import { homedir } from 'os';
import { resolve, normalize } from 'path';

/**
 * Get the home directory path.
 * 
 * @returns Absolute path to the user's home directory
 */
export function getHomeDirectory(): string {
  return homedir();
}

/**
 * Check if a path equals the home directory.
 * 
 * Handles path normalization to ensure accurate comparison.
 * 
 * @param path - Path to check
 * @returns True if path is the home directory
 */
export function isHomeDirectory(path: string): boolean {
  const normalizedPath = normalize(resolve(path));
  const normalizedHome = normalize(getHomeDirectory());
  return normalizedPath === normalizedHome;
}

/**
 * Convert home directory path to tilde notation for display.
 * 
 * Only converts if the path is exactly the home directory or
 * a subdirectory of it. Other paths are returned unchanged.
 * 
 * @param path - Absolute path to normalize
 * @returns Path with ~/ prefix if applicable, otherwise original path
 */
export function normalizePathWithTilde(path: string): string {
  const normalizedPath = normalize(resolve(path));
  const homeDir = getHomeDirectory();
  const normalizedHome = normalize(homeDir);
  
  // Exact match - return ~/
  if (normalizedPath === normalizedHome) {
    return '~/';
  }
  
  // Subdirectory of home - replace prefix
  if (normalizedPath.startsWith(normalizedHome + '/')) {
    return '~/' + normalizedPath.slice(normalizedHome.length + 1);
  }
  
  // Not in home directory - return as-is
  return normalizedPath;
}

/**
 * Expand tilde notation to full home directory path.
 * 
 * Used for path comparison in flow conditions and path resolution.
 * 
 * @param path - Path that may start with ~/
 * @returns Path with ~/ expanded to home directory
 */
export function expandTilde(path: string): string {
  if (path === '~' || path === '~/') {
    return getHomeDirectory();
  }
  
  if (path.startsWith('~/')) {
    return resolve(getHomeDirectory(), path.slice(2));
  }
  
  return path;
}
