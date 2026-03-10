/**
 * Move Index Updater
 *
 * Updates the workspace index (openpackage.index.yml) after rename or relocate operations.
 */

import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { logger } from '../../utils/logger.js';

/**
 * Update the workspace index after an in-place rename.
 *
 * Rewrites registry path keys in the files mapping: replaces old resource name
 * with the new name for all matching source keys.
 *
 * @param targetDir - Workspace root directory
 * @param packageName - Package containing the resource
 * @param oldResourceName - Previous resource name
 * @param newResourceName - New resource name
 * @param typeDir - Resource type directory (e.g. "agents", "skills")
 */
export async function updateIndexForRename(
  targetDir: string,
  packageName: string,
  oldResourceName: string,
  newResourceName: string,
  typeDir: string,
): Promise<void> {
  const record = await readWorkspaceIndex(targetDir);
  const pkgEntry = record.index.packages[packageName];

  if (!pkgEntry || !pkgEntry.files) {
    logger.debug(`updateIndexForRename: package "${packageName}" not in index, skipping.`);
    return;
  }

  const newFiles: Record<string, any[]> = {};
  let updated = false;

  for (const [sourceKey, targets] of Object.entries(pkgEntry.files)) {
    const newKey = renameSourceKey(sourceKey, typeDir, oldResourceName, newResourceName);
    newFiles[newKey] = targets;
    if (newKey !== sourceKey) {
      updated = true;
    }
  }

  if (updated) {
    pkgEntry.files = newFiles;
    await writeWorkspaceIndex(record);
    logger.info(`Updated workspace index for rename: ${oldResourceName} -> ${newResourceName} in ${packageName}`);
  }
}

/**
 * Rewrite a single source key by replacing the old resource name with the new one.
 *
 * Examples:
 *   agents/foo.md -> agents/bar.md
 *   skills/foo/SKILL.md -> skills/bar/SKILL.md
 *   skills/foo/sub/file.md -> skills/bar/sub/file.md
 */
function renameSourceKey(
  sourceKey: string,
  typeDir: string,
  oldName: string,
  newName: string,
): string {
  const parts = sourceKey.split('/');

  // Only rewrite keys that belong to the given type directory
  if (parts[0] !== typeDir) {
    return sourceKey;
  }

  // For directory-based: skills/oldName/... -> skills/newName/...
  // For file-based: agents/oldName.md -> agents/newName.md
  if (parts.length >= 2) {
    const segment = parts[1];
    // Check if segment matches oldName (with or without extension)
    const dotIdx = segment.lastIndexOf('.');
    const stem = dotIdx >= 0 ? segment.slice(0, dotIdx) : segment;

    if (stem === oldName) {
      const ext = dotIdx >= 0 ? segment.slice(dotIdx) : '';
      parts[1] = `${newName}${ext}`;
      return parts.join('/');
    }
  }

  return sourceKey;
}
