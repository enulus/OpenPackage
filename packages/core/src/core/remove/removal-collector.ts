import { join, relative, sep } from 'path';

import { exists, isDirectory, isFile, walkFiles } from '../../utils/fs.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';

export interface RemovalEntry {
  packagePath: string;    // Absolute path in package source
  registryPath: string;   // Relative path for display (normalized)
}

/**
 * Collect files to remove from package source based on path pattern.
 * 
 * @param packageRootDir - Absolute path to package root
 * @param pathPattern - Path pattern relative to package root (file or directory)
 * @returns Array of files to remove
 */
export async function collectRemovalEntries(
  packageRootDir: string,
  pathPattern: string
): Promise<RemovalEntry[]> {
  const entries: RemovalEntry[] = [];
  
  // Normalize the input path
  const normalizedPattern = normalizePathForProcessing(pathPattern) || pathPattern;
  const targetPath = join(packageRootDir, normalizedPattern);

  // Check if target exists
  if (!(await exists(targetPath))) {
    throw new Error(
      `Path '${pathPattern}' not found in package.\n` +
      `Package source: ${packageRootDir}`
    );
  }

  // Handle directory
  if (await isDirectory(targetPath)) {
    for await (const filePath of walkFiles(targetPath)) {
      const registryPath = relative(packageRootDir, filePath)
        .split(sep)
        .join('/');
      entries.push({
        packagePath: filePath,
        registryPath
      });
    }
    
    if (entries.length === 0) {
      throw new Error(
        `Directory '${pathPattern}' is empty.\n` +
        `No files to remove.`
      );
    }
    
    return entries;
  }

  // Handle single file
  if (await isFile(targetPath)) {
    const registryPath = relative(packageRootDir, targetPath)
      .split(sep)
      .join('/');
    entries.push({
      packagePath: targetPath,
      registryPath
    });
    return entries;
  }

  throw new Error(
    `Path '${pathPattern}' is not a file or directory.\n` +
    `Package source: ${packageRootDir}`
  );
}
