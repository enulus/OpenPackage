/**
 * File Scanner Utility
 * 
 * Scans all files in a workspace directory for interactive file selection.
 * Filters out junk files and common build/dependency directories.
 */

import { relative } from 'path';
import { isJunk } from 'junk';
import { walkFiles } from './file-walker.js';
import { logger } from './logger.js';

/**
 * Common directories to exclude from file scanning
 */
const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'out',
  '.cache',
  'coverage',
  '.nyc_output',
  '.parcel-cache',
  '.webpack',
  '.vscode',
  '.idea',
  '__pycache__',
  'target',
  'vendor',
]);

/**
 * Options for scanning workspace files
 */
export interface FileScanOptions {
  /** Base directory to scan from (default: process.cwd()) */
  cwd?: string;
  
  /** Specific directory path to scan (overrides cwd if provided) */
  basePath?: string;
  
  /** Additional directory names to exclude (merged with defaults) */
  excludeDirs?: string[];
  
  /** Maximum number of files to return (default: 10000) */
  maxFiles?: number;
  
  /** Whether to follow symbolic links (default: false) */
  followSymlinks?: boolean;
  
  /** Whether to include directories in results (default: false) */
  includeDirs?: boolean;
}

/**
 * Check if a path segment is an excluded directory
 */
function isExcludedDir(fullPath: string, excludeDirs: Set<string>): boolean {
  const segments = fullPath.split('/');
  
  // Check if any segment matches an excluded directory
  for (const segment of segments) {
    if (excludeDirs.has(segment)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Scan workspace for all non-junk files
 * 
 * @param options - Scanning options
 * @returns Array of relative file paths (and optionally directory paths with '/' suffix) from cwd (or basePath if specified)
 * 
 * @example
 * const files = await scanWorkspaceFiles({ cwd: '/path/to/workspace' });
 * // Returns: ['src/index.ts', 'package.json', '.openpkgs/rules/cursor.md', ...]
 * 
 * @example
 * // Scan a specific directory
 * const packageFiles = await scanWorkspaceFiles({ 
 *   cwd: '/workspace',
 *   basePath: '/workspace/.openpackage/packages/my-pkg'
 * });
 * // Returns files relative to basePath: ['file1.txt', 'subdir/file2.txt', ...]
 * 
 * @example
 * // Include directories in results
 * const filesAndDirs = await scanWorkspaceFiles({ 
 *   cwd: '/path/to/workspace',
 *   includeDirs: true
 * });
 * // Returns: ['src/', 'src/index.ts', 'src/utils/', 'src/utils/helper.ts', ...]
 */
export async function scanWorkspaceFiles(
  options: FileScanOptions = {}
): Promise<string[]> {
  const {
    cwd = process.cwd(),
    basePath,
    excludeDirs = [],
    maxFiles = 10000,
    followSymlinks = false,
    includeDirs = false
  } = options;
  
  // Use basePath if provided, otherwise use cwd
  const scanDir = basePath || cwd;
  
  // Merge default and custom exclude directories
  const allExcludeDirs = new Set([
    ...DEFAULT_EXCLUDE_DIRS,
    ...excludeDirs
  ]);
  
  const files: string[] = [];
  const dirs: string[] = [];
  let fileCount = 0;
  
  try {
    // Create filter for file walker
    const filter = (path: string, isDirectory: boolean) => {
      // Get the basename for junk checking
      const segments = path.split('/');
      const basename = segments[segments.length - 1];
      
      // Filter out junk files
      if (isJunk(basename)) {
        return false;
      }
      
      // Filter out excluded directories and their contents
      if (isExcludedDir(path, allExcludeDirs)) {
        return false;
      }
      
      return true;
    };
    
    // Walk files and collect relative paths
    for await (const filePath of walkFiles(scanDir, { filter, followSymlinks, includeDirs })) {
      // Stop if we've hit the max files limit
      if (fileCount >= maxFiles) {
        logger.debug(`File scan limit reached: ${maxFiles} files`);
        break;
      }
      
      // Convert to relative path for display
      const relativePath = relative(scanDir, filePath);
      
      // Skip if relative path is empty (shouldn't happen, but safety check)
      if (!relativePath || relativePath === '.') {
        continue;
      }
      
      // Check if this is a directory (when includeDirs is enabled)
      if (includeDirs) {
        const fs = await import('fs');
        const stat = await fs.promises.stat(filePath);
        if (stat.isDirectory()) {
          // Add '/' suffix to directories for visual distinction
          dirs.push(relativePath + '/');
        } else {
          files.push(relativePath);
        }
      } else {
        files.push(relativePath);
      }
      
      fileCount++;
    }
    
    // Sort files and directories for better UX
    // Directories first, then files, both alphabetically within their group
    const allItems = [...dirs.sort(), ...files.sort()];
    
    // Apply depth-based sorting to prioritize shallow items
    allItems.sort((a, b) => {
      // Remove trailing '/' for directory depth calculation
      const aPath = a.endsWith('/') ? a.slice(0, -1) : a;
      const bPath = b.endsWith('/') ? b.slice(0, -1) : b;
      
      // Prioritize items in root directory
      const aDepth = aPath.split('/').length;
      const bDepth = bPath.split('/').length;
      
      if (aDepth !== bDepth) {
        return aDepth - bDepth;
      }
      
      // Then alphabetically
      return a.localeCompare(b);
    });
    
    logger.debug(`Scanned ${allItems.length} items in workspace`, { scanDir, includeDirs });
    
    return allItems;
    
  } catch (error) {
    logger.error('Error scanning workspace files', { error, scanDir });
    throw new Error(`Failed to scan workspace files: ${error}`);
  }
}

/**
 * Check if the current environment supports interactive prompts
 * 
 * @returns True if stdin and stdout are TTY (terminal)
 */
export function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
