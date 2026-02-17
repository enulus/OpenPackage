import { join, basename } from 'path';

import { FILE_PATTERNS } from '../constants/index.js';
import { ensureLocalOpenPackageStructure, createWorkspacePackageYml } from './package-management.js';
import { getLocalOpenPackageDir } from './paths.js';
import { parsePackageYml } from './package-yml.js';
import type { PackageYml } from '../types/index.js';

/**
 * Workspace package context for add/remove operations.
 * Contains essential package metadata for operating on workspace root (.openpackage/).
 */
export interface WorkspacePackageContext {
  /** Package name (from manifest or workspace directory name) */
  name: string;
  /** Package version (if specified in manifest) */
  version?: string;
  /** Full package configuration from openpackage.yml */
  config: PackageYml;
  /** Absolute path to package manifest (openpackage.yml) */
  packageYmlPath: string;
  /** Root directory of the package (.openpackage/) */
  packageRootDir: string;
  /** Directory containing package files (same as root for workspace packages) */
  packageFilesDir: string;
}

/**
 * Build workspace package context for operations on workspace root (.openpackage/).
 * 
 * This utility creates or ensures the workspace package structure exists and loads
 * the manifest configuration. Used by add/remove commands when operating on the
 * workspace root (no specific package specified via --to/--from).
 * 
 * @param cwd - Current working directory
 * @returns Workspace package context with loaded configuration
 * @throws Error if manifest cannot be read
 * 
 * @example
 * // Add command: opkg add ./file.md (no --to option)
 * const context = await buildWorkspacePackageContext(cwd);
 * // Files will be added to context.packageRootDir (.openpackage/)
 * 
 * @example
 * // Remove command: opkg remove agents/my-agent (no --from option)
 * const context = await buildWorkspacePackageContext(cwd);
 * // Files will be removed from context.packageRootDir (.openpackage/)
 */
export async function buildWorkspacePackageContext(
  cwd: string
): Promise<WorkspacePackageContext> {
  // Ensure .openpackage/ structure exists
  await ensureLocalOpenPackageStructure(cwd);

  // Create workspace manifest if it doesn't exist
  await createWorkspacePackageYml(cwd);

  const openpackageDir = getLocalOpenPackageDir(cwd);
  const packageYmlPath = join(openpackageDir, FILE_PATTERNS.OPENPACKAGE_YML);

  // Load workspace manifest
  let config: PackageYml;
  try {
    config = await parsePackageYml(packageYmlPath);
  } catch (error) {
    throw new Error(
      `Failed to read workspace manifest at ${packageYmlPath}: ${error}`
    );
  }

  // Use workspace directory name as package name if not specified in manifest
  const packageName = config.name || basename(cwd);

  return {
    name: packageName,
    version: config.version,
    config,
    packageYmlPath,
    packageRootDir: openpackageDir,
    packageFilesDir: openpackageDir
  };
}

/**
 * Ensure workspace package structure exists and is initialized.
 * This is a convenience wrapper around ensureLocalOpenPackageStructure and createWorkspacePackageYml.
 * 
 * @param cwd - Current working directory
 * 
 * @example
 * // Ensure workspace is ready before performing operations
 * await ensureWorkspacePackageExists(cwd);
 * // Now .openpackage/ directory and openpackage.yml exist
 */
export async function ensureWorkspacePackageExists(cwd: string): Promise<void> {
  await ensureLocalOpenPackageStructure(cwd);
  await createWorkspacePackageYml(cwd);
}
