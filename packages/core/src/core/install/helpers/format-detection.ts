/**
 * Format Detection Helpers
 * 
 * Shared utilities for detecting package formats from directories.
 * Extracts common logic used by both flow-based-installer and flow-index-installer.
 */

import { relative } from 'path';
import { walkFiles } from '../../../utils/file-walker.js';
import { 
  detectPackageFormat, 
  detectPackageFormatWithContext,
  type PackageFormat
} from '../format-detector.js';
import type { PackageConversionContext } from '../../../types/conversion-context.js';
import { logger } from '../../../utils/logger.js';

/**
 * Load file list from package directory for format detection
 * Excludes .git directories
 * 
 * @param packageRoot - Root directory of the package
 * @returns Array of file paths with empty content strings
 */
export async function loadPackageFileList(
  packageRoot: string
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  
  try {
    for await (const fullPath of walkFiles(packageRoot)) {
      const relativePath = relative(packageRoot, fullPath);
      
      // Skip git metadata
      if (relativePath.startsWith('.git/') || relativePath === '.git') {
        continue;
      }
      
      files.push({
        path: relativePath,
        content: ''
      });
    }
  } catch (error) {
    logger.error('Failed to read package directory for format detection', { 
      packageRoot, 
      error 
    });
  }
  
  return files;
}

/**
 * Detect package format from directory
 * 
 * Convenience wrapper that loads file list and detects format.
 * 
 * @param packageRoot - Root directory of the package
 * @returns Detected package format
 */
export async function detectFormatFromDirectory(
  packageRoot: string
): Promise<PackageFormat> {
  const files = await loadPackageFileList(packageRoot);
  return detectPackageFormat(files);
}

/**
 * Detect package format with conversion context from directory
 * 
 * Convenience wrapper that loads file list and detects format with context.
 * Use this when you need both format and conversion context for the installation pipeline.
 * 
 * @param packageRoot - Root directory of the package
 * @returns Detected format and conversion context
 */
export async function detectFormatWithContextFromDirectory(
  packageRoot: string
): Promise<{ format: PackageFormat; context: PackageConversionContext }> {
  const files = await loadPackageFileList(packageRoot);
  return detectPackageFormatWithContext(files);
}
