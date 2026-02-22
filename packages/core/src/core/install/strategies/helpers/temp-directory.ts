/**
 * Temp Directory Helpers Module
 * 
 * Utilities for managing temporary directories during package conversion.
 */

import { join, dirname } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { ensureDir, writeTextFile } from '../../../../utils/fs.js';
import { logger } from '../../../../utils/logger.js';
import type { PackageConversionContext } from '../../../../types/conversion-context.js';
import { contextToJSON } from '../../../conversion-context/index.js';

/**
 * Create a temporary directory for package conversion
 * 
 * @param prefix - Prefix for temp directory name
 * @returns Absolute path to created temp directory
 */
export async function createTempPackageDirectory(prefix: string = 'opkg-converted-'): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  return tempDir;
}

/**
 * Create a conversion cache directory within git cache location.
 * This stores converted files alongside the original git cache for reuse.
 * 
 * @param gitCachePath - Path to git cache directory
 * @returns Absolute path to conversion cache directory
 */
export async function createConversionCacheDirectory(
  gitCachePath: string
): Promise<string> {
  const conversionDir = join(gitCachePath, '.opkg-converted');
  await ensureDir(conversionDir);
  return conversionDir;
}

/**
 * Write package files to temporary directory
 * 
 * @param files - Array of files to write
 * @param tempDir - Temporary directory path
 */
export async function writeTempPackageFiles(
  files: Array<{ path: string; content: string }>,
  tempDir: string
): Promise<void> {
  for (const file of files) {
    const filePath = join(tempDir, file.path);
    await ensureDir(dirname(filePath));
    await writeTextFile(filePath, file.content);
  }
}

/**
 * Write conversion context to temporary directory
 * 
 * @param context - Conversion context to write
 * @param tempDir - Temporary directory path
 */
export async function writeConversionContext(
  context: PackageConversionContext,
  tempDir: string
): Promise<void> {
  const contextPath = join(tempDir, '.opkg-conversion-context.json');
  const contextJson = contextToJSON(context);
  await writeTextFile(contextPath, contextJson);
}

/**
 * Cleanup temporary directory with error handling
 * 
 * @param tempDir - Directory to cleanup
 */
export async function cleanupTempDirectory(tempDir: string | null): Promise<void> {
  if (!tempDir) {
    return;
  }
  
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to cleanup temp directory', {
      tempDir,
      error
    });
  }
}
