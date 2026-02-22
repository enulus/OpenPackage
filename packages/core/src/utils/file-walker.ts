/**
 * File Walker Utility
 * 
 * Provides efficient file system traversal utilities for walking directory trees.
 * Used across install, save, status, pack, and other commands.
 */

import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Filter predicate for file walking
 */
export type FileFilter = (path: string, isDirectory: boolean) => boolean | Promise<boolean>;

/**
 * Options for file walking
 */
export interface WalkOptions {
  /**
   * Filter predicate to include/exclude files and directories
   */
  filter?: FileFilter;
  
  /**
   * Follow symbolic links (default: false)
   */
  followSymlinks?: boolean;
  
  /**
   * Maximum depth to traverse (default: unlimited)
   */
  maxDepth?: number;
  
  /**
   * Include directories in results (default: false, only files)
   */
  includeDirs?: boolean;
}

/**
 * Async generator that walks a directory tree and yields file paths
 * 
 * @param dir - Directory to walk
 * @param options - Walking options
 * 
 * @example
 * for await (const filePath of walkFiles('/path/to/dir')) {
 *   console.log(filePath);
 * }
 */
export async function* walkFiles(
  dir: string,
  options: WalkOptions = {}
): AsyncGenerator<string> {
  const {
    filter,
    followSymlinks = false,
    maxDepth = Infinity,
    includeDirs = false
  } = options;
  
  yield* walkFilesInternal(dir, filter, followSymlinks, maxDepth, includeDirs, 0);
}

/**
 * Internal recursive walker
 */
async function* walkFilesInternal(
  dir: string,
  filter: FileFilter | undefined,
  followSymlinks: boolean,
  maxDepth: number,
  includeDirs: boolean,
  currentDepth: number
): AsyncGenerator<string> {
  // Check depth limit
  if (currentDepth > maxDepth) {
    return;
  }
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      // Handle symlinks
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      
      if (entry.isSymbolicLink() && followSymlinks) {
        try {
          const stat = await fs.stat(fullPath);
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          // Skip broken symlinks
          continue;
        }
      } else if (entry.isSymbolicLink()) {
        // Skip symlinks if not following
        continue;
      }
      
      // Apply filter
      if (filter) {
        const shouldInclude = await filter(fullPath, isDirectory);
        if (!shouldInclude) {
          continue;
        }
      }
      
      // Yield directories if requested
      if (isDirectory && includeDirs) {
        yield fullPath;
      }
      
      // Recurse into directories
      if (isDirectory) {
        yield* walkFilesInternal(
          fullPath,
          filter,
          followSymlinks,
          maxDepth,
          includeDirs,
          currentDepth + 1
        );
      } else if (isFile) {
        // Yield files
        yield fullPath;
      }
    }
  } catch (error) {
    // Ignore permission errors and continue
    if ((error as NodeJS.ErrnoException).code !== 'EACCES' && 
        (error as NodeJS.ErrnoException).code !== 'EPERM') {
      throw error;
    }
  }
}

/**
 * Walk directory and collect all files into an array
 * 
 * @param dir - Directory to walk
 * @param options - Walking options
 * @returns Array of file paths
 */
export async function collectFiles(
  dir: string,
  options: WalkOptions = {}
): Promise<string[]> {
  const files: string[] = [];
  
  for await (const filePath of walkFiles(dir, options)) {
    files.push(filePath);
  }
  
  return files;
}

/**
 * Walk directory with a simple include/exclude pattern filter
 * 
 * @param dir - Directory to walk
 * @param includePatterns - Patterns to include (minimatch)
 * @param excludePatterns - Patterns to exclude (minimatch)
 * @returns Async generator of matching file paths
 */
export async function* walkWithPatterns(
  dir: string,
  includePatterns: string[] = ['**/*'],
  excludePatterns: string[] = []
): AsyncGenerator<string> {
  const { minimatch } = await import('minimatch');
  const { relative } = await import('path');
  
  const filter: FileFilter = (path: string, isDirectory: boolean) => {
    // Always traverse directories
    if (isDirectory) {
      return true;
    }
    
    const relativePath = relative(dir, path);
    
    // Check exclusions first
    for (const pattern of excludePatterns) {
      if (minimatch(relativePath, pattern, { dot: true })) {
        return false;
      }
    }
    
    // Check inclusions
    for (const pattern of includePatterns) {
      if (minimatch(relativePath, pattern, { dot: true })) {
        return true;
      }
    }
    
    return false;
  };
  
  yield* walkFiles(dir, { filter });
}

/**
 * Count files in a directory (without collecting them all)
 * 
 * @param dir - Directory to walk
 * @param options - Walking options
 * @returns Number of files
 */
export async function countFiles(
  dir: string,
  options: WalkOptions = {}
): Promise<number> {
  let count = 0;
  
  for await (const _ of walkFiles(dir, options)) {
    count++;
  }
  
  return count;
}
