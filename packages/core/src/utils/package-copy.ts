/**
 * Package file I/O utilities for reading from and writing to package directories.
 *
 * This module provides two main operations:
 *   - readPackageFilesForRegistry: Collect files from a package directory into a
 *     registry-ready payload, applying static exclusions (no manifest filters).
 *   - writePackageFilesToDirectory: Write a set of PackageFile entries to disk,
 *     syncing the directory contents (removing stale files).
 */

import { join, relative, dirname } from 'path';

import type { PackageFile } from '../types/index.js';
import { DIR_PATTERNS, FILE_PATTERNS } from '../constants/index.js';
import {
  exists,
  ensureDir,
  readTextFile,
  writeTextFile,
  walkFiles,
  remove
} from './fs.js';
import { logger } from './logger.js';
import { normalizePathForProcessing } from './path-normalization.js';
import { isExcludedFromPackage } from './package-filters.js';

// ─────────────────────────────────────────────────────────────────────────────
// Reading package files
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read package files from disk and return a registry-ready payload.
 *
 * Applies static exclusions (package index file, packages/** nested dirs).
 *
 * @param packageDir - Absolute path to the package root directory.
 * @returns Array of PackageFile entries representing the canonical payload.
 */
export async function readPackageFilesForRegistry(packageDir: string): Promise<PackageFile[]> {
  if (!(await exists(packageDir))) {
    return [];
  }

  const files: PackageFile[] = [];

  for await (const fullPath of walkFiles(packageDir)) {
    const relativePath = normalizePathForProcessing(relative(packageDir, fullPath));

    // Layer 1: static exclusions (always enforced)
    if (isExcludedFromPackage(relativePath)) {
      logger.debug(`Skipping static-excluded path: ${relativePath}`);
      continue;
    }

    const content = await readTextFile(fullPath);
    files.push({ path: relativePath, content, encoding: 'utf8' });
  }

  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing package files
// ─────────────────────────────────────────────────────────────────────────────

export interface WritePackageFilesOptions {
  /**
   * When true, preserve the package index file even if it's not in the
   * incoming file list. Useful when writing to the local cache where the
   * index should persist across updates.
   */
  preserveIndexFile?: boolean;
}

/**
 * Write package files to a directory, syncing its contents.
 *
 * - Creates the target directory if it doesn't exist.
 * - Removes files that are no longer part of the payload (except protected paths).
 * - Writes all incoming files, creating subdirectories as needed.
 *
 * @param targetDir - Absolute path to the destination directory.
 * @param files - Array of PackageFile entries to write.
 * @param options - Optional settings (e.g., preserveIndexFile).
 */
export async function writePackageFilesToDirectory(
  targetDir: string,
  files: PackageFile[],
  options: WritePackageFilesOptions = {}
): Promise<void> {
  await ensureDir(targetDir);

  // Build the set of paths that should remain after the write
  const pathsToKeep = new Set<string>(files.map(f => normalizePathForProcessing(f.path)));

    if (options.preserveIndexFile) {
      pathsToKeep.add(FILE_PATTERNS.OPENPACKAGE_INDEX_YML);
  }

  // Remove stale files (but never touch protected paths like packages/**)
  await removeStaleFiles(targetDir, pathsToKeep);

  // Write all incoming files in parallel
  await Promise.all(files.map(file => writeFile(targetDir, file)));
}

/**
 * Remove files in targetDir that are not in pathsToKeep and are not protected.
 */
async function removeStaleFiles(targetDir: string, pathsToKeep: Set<string>): Promise<void> {
  if (!(await exists(targetDir))) {
    return;
  }

  for await (const fullPath of walkFiles(targetDir)) {
    const relPath = normalizePathForProcessing(relative(targetDir, fullPath));

    // Skip files we want to keep
    if (pathsToKeep.has(relPath)) {
      continue;
    }

    // Never delete protected paths (e.g., packages/**)
    if (isExcludedFromPackage(relPath)) {
      continue;
    }

    try {
      await remove(fullPath);
      logger.debug(`Removed stale file: ${relPath}`);
    } catch (error) {
      logger.warn(`Failed to remove stale file ${relPath}: ${error}`);
    }
  }
}

/**
 * Write a single PackageFile to disk under targetDir.
 */
async function writeFile(targetDir: string, file: PackageFile): Promise<void> {
  const targetPath = join(targetDir, file.path);
  await ensureDir(dirname(targetPath));
  await writeTextFile(targetPath, file.content, (file.encoding as BufferEncoding) ?? 'utf8');
}


