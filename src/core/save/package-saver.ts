/**
 * Registry write operations for save/pack commands.
 *
 * This module handles persisting a package version to the local registry at
 * ~/.openpackage/registry/<name>/<version>/...
 */

import type { PackageFile, PackageYml } from '../../types/index.js';
import type { PackageContext } from '../package-context.js';
import * as yaml from 'js-yaml';
import { normalizePackageName } from '../../utils/package-name.js';
import { remove } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { packageManager } from '../package.js';
import { getPackageVersionPath } from '../directory.js';
import { packageVersionExists } from '../../utils/package-versioning.js';
import { writePackageFilesToDirectory } from '../../utils/package-copy.js';
import { mergePackageFiles, stripPartialFlag } from '../../utils/package-merge.js';
import { PACKAGE_PATHS } from '../../constants/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveToRegistryResult {
  success: boolean;
  error?: string;
  /** The config with normalized package name that was actually written. */
  updatedConfig?: PackageYml;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save a package version to the local registry.
 *
 * - Normalizes the package name for consistent registry paths.
 * - Clears any existing version directory before writing (idempotent overwrites).
 * - Writes all provided files to the registry version directory.
 *
 * @param packageContext - Metadata about the package (name, version, paths).
 * @param files - The registry payload to persist.
 * @returns Result indicating success/failure and the normalized config.
 */
export async function savePackageToRegistry(
  packageContext: PackageContext,
  files: PackageFile[]
): Promise<SaveToRegistryResult> {
  const { config } = packageContext;
  const normalizedName = normalizePackageName(config.name);
  const normalizedConfig: PackageYml = { ...config, name: normalizedName };

  const versionDir = getPackageVersionPath(normalizedName, normalizedConfig.version);
  const manifestIsPartial = isManifestPartial(files);
  const registryHasPackage = await packageManager.packageExists(normalizedName);

  let filesToWrite = files;

  if (manifestIsPartial && registryHasPackage) {
    const baseFiles = await loadExistingFiles(normalizedName, normalizedConfig.version);
    filesToWrite = mergePackageFiles(baseFiles, filesToWrite);
  }

  if (manifestIsPartial) {
    filesToWrite = stripPartialFlag(filesToWrite, normalizedName);
    delete (normalizedConfig as any).partial;
  }

  try {
    await clearExistingVersion(normalizedName, normalizedConfig.version, versionDir);
    await writePackageFilesToDirectory(versionDir, filesToWrite);

    return { success: true, updatedConfig: normalizedConfig };
  } catch (error) {
    const message = `Failed to save ${normalizedName}@${normalizedConfig.version}: ${error}`;
    logger.error(message);
    return { success: false, error: message };
  }
}

function isManifestPartial(files: PackageFile[]): boolean {
  const manifest = files.find(f => f.path === PACKAGE_PATHS.MANIFEST_RELATIVE);
  if (!manifest) return false;

  try {
    const parsed = yaml.load(manifest.content) as any;
    return parsed?.partial === true;
  } catch {
    return false;
  }
}

async function loadExistingFiles(packageName: string, version?: string): Promise<PackageFile[]> {
  try {
    return (await packageManager.loadPackage(packageName, version)).files;
  } catch (error) {
    logger.debug(`No existing version to merge`, { packageName, version, error });
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove an existing version directory if present (ensures clean overwrites).
 */
async function clearExistingVersion(
  packageName: string,
  version: string | undefined,
  versionDir: string
): Promise<void> {
  if (await packageVersionExists(packageName, version)) {
    await remove(versionDir);
    logger.debug(`Cleared existing registry version: ${versionDir}`);
  }
}
