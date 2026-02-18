/**
 * Directory Selection Expansion Utility
 * 
 * Expands directory selections (paths ending with '/') into all files within them.
 * Used by add and remove commands to handle directory selections from interactive file selector.
 */

import { join, relative } from 'path';
import { promises as fs } from 'fs';
import { walkFiles } from './file-walker.js';
import { isJunk } from 'junk';

/**
 * Expand directory selections into individual file paths
 * 
 * @param selectedPaths - Array of selected paths (files and directories with '/' suffix)
 * @param basePath - Base directory path for resolving relative paths
 * @returns Array of individual file paths (no directories)
 * 
 * @example
 * const selections = ['src/', 'package.json', 'docs/readme.md'];
 * const expanded = await expandDirectorySelections(selections, '/workspace');
 * // Returns: ['src/index.ts', 'src/utils/helper.ts', 'package.json', 'docs/readme.md']
 */
export async function expandDirectorySelections(
  selectedPaths: string[],
  basePath: string
): Promise<string[]> {
  const expandedFiles: string[] = [];
  const seenFiles = new Set<string>();
  
  for (const path of selectedPaths) {
    if (path.endsWith('/')) {
      // This is a directory - expand it to all files within
      const dirPath = path.slice(0, -1); // Remove trailing '/'
      const absDirPath = join(basePath, dirPath);
      
      // Check if directory exists
      try {
        const stat = await fs.stat(absDirPath);
        if (!stat.isDirectory()) {
          // Not a directory, skip
          continue;
        }
      } catch {
        // Directory doesn't exist or is inaccessible, skip
        continue;
      }
      
      // Walk all files in the directory
      const filter = (filePath: string, isDirectory: boolean) => {
        if (isDirectory) {
          return true; // Always traverse directories
        }
        
        // Filter out junk files
        const segments = filePath.split('/');
        const basename = segments[segments.length - 1];
        return !isJunk(basename);
      };
      
      for await (const filePath of walkFiles(absDirPath, { filter })) {
        // Convert to relative path from basePath (path.relative handles trailing slashes correctly)
        const relativePath = relative(basePath, filePath);
        
        // Only add if not already seen (avoid duplicates)
        if (!seenFiles.has(relativePath)) {
          seenFiles.add(relativePath);
          expandedFiles.push(relativePath);
        }
      }
    } else {
      // This is a regular file - add it directly if not already seen
      if (!seenFiles.has(path)) {
        seenFiles.add(path);
        expandedFiles.push(path);
      }
    }
  }
  
  return expandedFiles;
}

/**
 * Check if any selected paths are directories
 * 
 * @param selectedPaths - Array of selected paths
 * @returns True if at least one path is a directory (ends with '/')
 */
export function hasDirectorySelections(selectedPaths: string[]): boolean {
  return selectedPaths.some(path => path.endsWith('/'));
}

/**
 * Count how many directories and files are in the selection
 * 
 * @param selectedPaths - Array of selected paths
 * @returns Object with counts of directories and files
 */
export function countSelectionTypes(selectedPaths: string[]): { dirs: number; files: number } {
  let dirs = 0;
  let files = 0;
  
  for (const path of selectedPaths) {
    if (path.endsWith('/')) {
      dirs++;
    } else {
      files++;
    }
  }
  
  return { dirs, files };
}
