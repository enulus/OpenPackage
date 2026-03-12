/**
 * Workspace Index Healer
 *
 * Validates workspace index entries against the filesystem and removes
 * stale mappings (files that no longer exist on disk). This self-healing
 * prevents commands from failing on phantom file references.
 */

import path from 'path';

import { exists } from './fs.js';
import { getTargetPath } from './workspace-index-helpers.js';
import { writeWorkspaceIndex, getWorkspaceIndexPath } from './workspace-index-yml.js';
import type { WorkspaceIndex } from '../types/workspace-index.js';
import { logger } from './logger.js';

export interface HealResult {
  healed: boolean;
  removedMappings: number;
}

/**
 * Validate workspace index file mappings against disk and remove stale entries.
 *
 * For each package, iterates file mappings and checks if target files exist.
 * Removes mappings whose targets are missing. If a source key's entire target
 * array becomes empty, deletes the source key. Preserves package entries even
 * if all files are gone (keeps path/version metadata for reinstall hints).
 *
 * Mutates the index in place and returns whether any healing occurred.
 *
 * @param targetDir - Workspace root directory
 * @param index - Workspace index (mutated in place)
 * @param packageName - If specified, only heal this package's mappings
 */
export async function validateAndHeal(
  targetDir: string,
  index: WorkspaceIndex,
  packageName?: string,
): Promise<HealResult> {
  let removedMappings = 0;

  const packages = packageName
    ? (index.packages[packageName] ? { [packageName]: index.packages[packageName] } : {})
    : index.packages;

  for (const pkg of Object.values(packages)) {
    if (!pkg.files) continue;

    for (const [sourceKey, targets] of Object.entries(pkg.files)) {
      if (!Array.isArray(targets) || targets.length === 0) continue;

      const kept = [];
      for (const mapping of targets) {
        const targetPath = getTargetPath(mapping);
        const absTarget = path.join(targetDir, targetPath);
        if (await exists(absTarget)) {
          kept.push(mapping);
        } else {
          removedMappings++;
          logger.debug(`Healed stale mapping: ${targetPath} (file missing from disk)`);
        }
      }

      if (kept.length === 0) {
        delete pkg.files[sourceKey];
      } else if (kept.length < targets.length) {
        pkg.files[sourceKey] = kept;
      }
    }
  }

  return { healed: removedMappings > 0, removedMappings };
}

/**
 * Convenience: validate, heal, and persist the index in one call.
 * Best-effort — logs and swallows errors so callers don't need try/catch.
 *
 * @returns The heal result, or `{ healed: false, removedMappings: 0 }` on error.
 */
export async function healAndPersistIndex(
  targetDir: string,
  index: WorkspaceIndex,
  indexPath: string,
  packageName?: string,
): Promise<HealResult> {
  try {
    const result = await validateAndHeal(targetDir, index, packageName);
    if (result.healed) {
      await writeWorkspaceIndex({ path: indexPath, index });
    }
    return result;
  } catch (error) {
    logger.warn(`Index healing failed: ${error}`);
    return { healed: false, removedMappings: 0 };
  }
}
