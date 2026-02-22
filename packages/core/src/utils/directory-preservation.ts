/**
 * Directory Preservation Utilities
 * 
 * Determines which directories should be preserved during uninstall cleanup.
 * Uses platform detection patterns to identify platform root directories that
 * should never be removed, even if empty.
 */

import path from 'path';
import { getAllPlatforms, getPlatformDefinition } from '../core/platforms.js';

/**
 * Extract the directory path from a detection pattern.
 * 
 * Detection patterns can be:
 * - Directory names: ".cursor", ".claude"
 * - File paths: ".claude-plugin/plugin.json", "CLAUDE.md"
 * - Future: glob patterns
 * 
 * @param pattern - Detection pattern from platform definition
 * @param targetDir - Target directory (workspace root or global home)
 * @returns Absolute directory path to preserve, or null if pattern points to workspace root
 * 
 * @example
 * extractDirectoryFromPattern(".cursor", "/workspace") 
 *   → "/workspace/.cursor"
 * 
 * extractDirectoryFromPattern(".claude-plugin/plugin.json", "/workspace")
 *   → "/workspace/.claude-plugin"
 * 
 * extractDirectoryFromPattern("CLAUDE.md", "/workspace")
 *   → null (root file, don't preserve workspace root)
 */
export function extractDirectoryFromPattern(pattern: string, targetDir: string): string | null {
  // Normalize path separators
  const normalized = pattern.replace(/\\/g, '/');
  
  // Check if it's a directory or a file
  // A dotfile directory (e.g., ".cursor", ".claude") is a single segment starting with "."
  // and no path separators — distinct from a file extension like "file.md"
  const isDotfileDir = /^\.[^./]+$/.test(normalized);
  const hasExtension = !isDotfileDir && /\.[a-z0-9]+$/i.test(normalized);
  const isDirectory = normalized.endsWith('/') || !hasExtension;
  
  let dirPath: string;
  
  if (isDirectory) {
    // Remove trailing slash if present
    dirPath = normalized.replace(/\/$/, '');
  } else {
    // Extract directory from file path
    const lastSlash = normalized.lastIndexOf('/');
    dirPath = lastSlash >= 0 ? normalized.substring(0, lastSlash) : '';
  }
  
  // Convert to absolute path
  const absPath = dirPath ? path.join(targetDir, dirPath) : targetDir;
  
  // Don't preserve the workspace root itself
  // Root files (like CLAUDE.md, AGENTS.md) have their own preservation logic
  return absPath === targetDir ? null : absPath;
}

/**
 * Build a Set of absolute directory paths that should be preserved during cleanup.
 * 
 * These directories are identified from platform detection patterns and represent
 * platform root directories (e.g., .cursor, .claude, .opencode) that should never
 * be removed, even if they become empty after uninstalling packages.
 * 
 * @param targetDir - Target directory (workspace root or global home)
 * @returns Set of absolute directory paths to preserve
 * 
 * @example
 * buildPreservedDirectoriesSet("/workspace")
 *   → Set([
 *       "/workspace/.cursor",
 *       "/workspace/.claude", 
 *       "/workspace/.opencode",
 *       "/workspace/.claude-plugin",
 *       ...
 *     ])
 */
export function buildPreservedDirectoriesSet(targetDir: string): Set<string> {
  const preserved = new Set<string>();
  const platforms = getAllPlatforms(undefined, targetDir);
  
  for (const platform of platforms) {
    const definition = getPlatformDefinition(platform, targetDir);
    
    // Primary: use detection patterns
    if (definition.detection && definition.detection.length > 0) {
      for (const pattern of definition.detection) {
        const dirToPreserve = extractDirectoryFromPattern(pattern, targetDir);
        if (dirToPreserve) {
          preserved.add(dirToPreserve);
        }
      }
    } else if (definition.rootDir) {
      // Fallback: use rootDir for platforms without detection patterns
      const rootPath = path.join(targetDir, definition.rootDir);
      if (rootPath !== targetDir) {
        preserved.add(rootPath);
      }
    }
  }
  
  return preserved;
}
