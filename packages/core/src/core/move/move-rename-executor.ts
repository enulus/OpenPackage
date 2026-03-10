/**
 * Move Rename Executor
 *
 * In-place rename of a resource within a package source directory.
 * Handles both directory-based resources (skills) and file-based resources
 * (agents, rules, commands, hooks).
 */

import { join, dirname, basename, extname } from 'path';
import { promises as fsNative } from 'fs';

import { getSingularTypeFromDir, getMarkerFilename } from '../resources/resource-registry.js';
import { renameFrontmatterName } from '../add/entry-renamer.js';
import { readTextFile, writeTextFile, exists, remove, ensureDir } from '../../utils/fs.js';
import { MARKDOWN_EXTENSIONS } from '../../constants/index.js';
import { logger } from '../../utils/logger.js';

export interface RenameResult {
  oldPaths: string[];
  newPaths: string[];
  renamedFiles: number;
}

/**
 * Execute an in-place rename of a resource in a package source directory.
 *
 * @param packageRoot - Absolute path to the package source root
 * @param sourceKeys - Source keys (registry paths) belonging to this resource
 * @param resourceName - Current resource name
 * @param newName - Desired new resource name
 */
export async function executeInPlaceRename(
  packageRoot: string,
  sourceKeys: Set<string>,
  resourceName: string,
  newName: string,
): Promise<RenameResult> {
  const oldPaths: string[] = [];
  const newPaths: string[] = [];

  // Determine resource type from the first source key
  const firstKey = [...sourceKeys][0];
  if (!firstKey) {
    throw new Error(`No source keys found for resource "${resourceName}".`);
  }

  const parts = firstKey.split('/');
  const typeDir = parts[0]; // e.g. "agents", "skills"
  const typeId = getSingularTypeFromDir(typeDir);
  const marker = typeId ? getMarkerFilename(typeId) : null;

  if (marker) {
    // Directory-based resource (e.g. skills/foo/ -> skills/bar/)
    const oldDir = join(packageRoot, typeDir, resourceName);
    const newDir = join(packageRoot, typeDir, newName);

    if (!(await exists(oldDir))) {
      throw new Error(`Resource directory not found: ${oldDir}`);
    }

    if (await exists(newDir)) {
      throw new Error(`Target directory already exists: ${newDir}`);
    }

    // Rename the directory
    await ensureDir(dirname(newDir));
    await fsNative.rename(oldDir, newDir);

    // Update frontmatter in marker file
    const markerPath = join(newDir, marker);
    if (await exists(markerPath)) {
      const ext = extname(marker).toLowerCase();
      if (MARKDOWN_EXTENSIONS.has(ext)) {
        const content = await readTextFile(markerPath);
        const updated = renameFrontmatterName(content, newName);
        if (updated !== content) {
          await writeTextFile(markerPath, updated);
        }
      }
    }

    // Build old/new path lists from source keys
    for (const key of sourceKeys) {
      const oldAbsPath = join(packageRoot, key);
      // Replace the resource name directory component
      const keyParts = key.split('/');
      if (keyParts.length >= 2 && keyParts[1] === resourceName) {
        keyParts[1] = newName;
      }
      const newKey = keyParts.join('/');
      const newAbsPath = join(packageRoot, newKey);
      oldPaths.push(oldAbsPath);
      newPaths.push(newAbsPath);
    }

    logger.info(`Renamed skill directory: ${resourceName} -> ${newName}`, {
      oldDir,
      newDir,
      filesRenamed: sourceKeys.size,
    });
  } else {
    // File-based resource (e.g. agents/foo.md -> agents/bar.md)
    for (const key of sourceKeys) {
      const oldAbsPath = join(packageRoot, key);
      const fileName = basename(key);
      const ext = extname(fileName);
      const stem = basename(fileName, ext);

      let newKey: string;
      if (stem === resourceName) {
        const dir = dirname(key);
        newKey = dir === '.' ? `${newName}${ext}` : `${dir}/${newName}${ext}`;
      } else {
        // Non-primary file in the resource; keep as-is
        newKey = key;
      }

      const newAbsPath = join(packageRoot, newKey);

      if (oldAbsPath !== newAbsPath) {
        // Rename frontmatter in markdown files; plain rename for others
        const extLower = ext.toLowerCase();
        if (MARKDOWN_EXTENSIONS.has(extLower)) {
          const content = await readTextFile(oldAbsPath);
          const updated = renameFrontmatterName(content, newName);
          await writeTextFile(newAbsPath, updated);
          await remove(oldAbsPath);
        } else {
          await fsNative.rename(oldAbsPath, newAbsPath);
        }
      }

      oldPaths.push(oldAbsPath);
      newPaths.push(newAbsPath);
    }

    logger.info(`Renamed file-based resource: ${resourceName} -> ${newName}`, {
      filesRenamed: sourceKeys.size,
    });
  }

  return {
    oldPaths,
    newPaths,
    renamedFiles: sourceKeys.size,
  };
}
