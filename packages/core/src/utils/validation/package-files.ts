import { readPackageFilesForRegistry } from '../package-copy.js';
import type { PackageFile } from '../../types/index.js';

export interface PackageFilesValidationOptions {
  /** Context for error messages */
  context?: string;
  /** Throw error if no files found (default: true) */
  throwOnEmpty?: boolean;
}

/**
 * Read and validate package files from directory
 * Throws if no files found (unless throwOnEmpty: false)
 */
export async function validateAndReadPackageFiles(
  packageRoot: string,
  options: PackageFilesValidationOptions = {}
): Promise<PackageFile[]> {
  const files = await readPackageFilesForRegistry(packageRoot);
  
  const throwOnEmpty = options.throwOnEmpty !== false;
  
  if (files.length === 0 && throwOnEmpty) {
    const context = options.context || 'package';
    throw new Error(`No files found to include in ${context}`);
  }
  
  return files;
}
