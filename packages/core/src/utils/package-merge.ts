import * as yaml from 'js-yaml';
import { PackageFile, PackageYml } from '../types/index.js';
import { PACKAGE_PATHS } from '../constants/index.js';
import { normalizePathForProcessing } from './path-normalization.js';
import { serializePackageYml } from './package-yml.js';

const PACKAGE_INDEX = normalizePathForProcessing(PACKAGE_PATHS.INDEX_RELATIVE);

/**
 * Merge two sets of package files:
 * - normalizes paths
 * - skips package index
 * - incoming wins on conflicts
 */
export function mergePackageFiles(base: PackageFile[], incoming: PackageFile[]): PackageFile[] {
  const byPath = new Map<string, PackageFile>();

  const addAll = (list: PackageFile[]) => {
    for (const file of list) {
      const normalized = normalizePathForProcessing(file.path) || file.path;
      if (normalized === PACKAGE_INDEX) continue; // never merge index
      byPath.set(normalized, { ...file, path: normalized });
    }
  };

  addAll(base);
  addAll(incoming);

  return Array.from(byPath.values());
}

/**
 * Remove partial: true from manifest content if present, re-serializing with existing helper.
 */
export function stripPartialFlag(files: PackageFile[], fallbackName?: string): PackageFile[] {
  return files.map(file => {
    const normalized = normalizePathForProcessing(file.path) || file.path;
    if (normalized !== PACKAGE_PATHS.MANIFEST_RELATIVE) {
      return file;
    }

    try {
      const parsed = (yaml.load(file.content) as PackageYml) || { name: fallbackName };
      if ((parsed as any).partial !== undefined) {
        delete (parsed as any).partial;
        return { ...file, content: serializePackageYml(parsed) };
      }
      return file;
    } catch {
      return file;
    }
  });
}

