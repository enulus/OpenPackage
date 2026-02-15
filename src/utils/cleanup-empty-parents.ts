import path from 'path';
import { readdir } from 'fs/promises';

import { remove } from './fs.js';
import { logger } from './logger.js';

/**
 * Clean up empty parent directories after file deletion.
 * 
 * Walks up the directory tree from each deleted file, removing empty directories
 * until hitting a preserved directory or the root.
 * 
 * For platform files (e.g., .cursor/commands/essentials/file.md):
 * - Removes empty subdirectories (essentials/, commands/)
 * - Stops at and preserves the platform root (.cursor/)
 * 
 * For root files (e.g., docs/guides/file.md):
 * - Removes all empty parent directories
 * - Stops only at workspace root
 * 
 * @param rootDir - Root directory boundary (workspace root or package root)
 * @param deletedPaths - Absolute paths of deleted files
 * @param preservedDirs - Set of absolute directory paths to preserve (never remove)
 */
export async function cleanupEmptyParents(
  rootDir: string,
  deletedPaths: string[],
  preservedDirs: Set<string> = new Set()
): Promise<void> {
  const candidateDirs = new Set<string>();

  // Collect all parent directories from deleted files
  for (const deletedPath of deletedPaths) {
    let current = path.dirname(deletedPath);
    
    // Walk up the directory tree
    while (current.startsWith(rootDir) && current !== rootDir) {
      // Stop at preserved directories (platform roots)
      if (preservedDirs.has(current)) {
        break;
      }
      
      candidateDirs.add(current);
      current = path.dirname(current);
    }
  }

  // Sort by depth (deepest first) to ensure we process child directories before parents
  const sorted = Array.from(candidateDirs).sort((a, b) => b.length - a.length);
  
  // Remove empty directories
  for (const dir of sorted) {
    try {
      const entries = await readdir(dir);
      
      // Only remove if directory is empty and not preserved
      if (entries.length === 0 && !preservedDirs.has(dir)) {
        await remove(dir);
        logger.debug(`Removed empty directory: ${path.relative(rootDir, dir)}`);
      }
    } catch (error) {
      // Ignore errors (directory may not exist, permission issues, etc.)
      logger.debug(`Could not process directory ${dir}: ${error}`);
    }
  }
}
