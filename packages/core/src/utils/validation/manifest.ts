import path from 'path';
import { FILE_PATTERNS } from '../../constants/index.js';
import { exists } from '../fs.js';
import { parsePackageYml } from '../package-yml.js';
import type { PackageYml } from '../../types/index.js';

export interface ManifestValidationOptions {
  /** Context for error messages */
  context?: string;
}

/**
 * Check if manifest exists at given path
 * Throws descriptive error if not found
 */
export async function validateManifestExists(
  manifestPath: string,
  options: ManifestValidationOptions = {}
): Promise<void> {
  if (!(await exists(manifestPath))) {
    const context = options.context || 'current directory';
    throw new Error(
      `No ${FILE_PATTERNS.OPENPACKAGE_YML} found in ${context}.\n` +
      `Run this command from a package root directory or ensure the manifest exists.`
    );
  }
}

/**
 * Load and validate manifest from directory
 * Returns parsed manifest, throws on errors
 */
export async function loadAndValidateManifest(
  directory: string,
  options: ManifestValidationOptions = {}
): Promise<PackageYml> {
  const manifestPath = path.join(directory, FILE_PATTERNS.OPENPACKAGE_YML);
  
  await validateManifestExists(manifestPath, options);
  
  // parsePackageYml already validates name field and dependencies
  const manifest = await parsePackageYml(manifestPath);
  
  return manifest;
}
