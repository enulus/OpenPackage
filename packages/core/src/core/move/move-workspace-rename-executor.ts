/**
 * Move Workspace Rename Executor
 *
 * Renames an untracked resource in the workspace platform directories.
 * Handles both directory-based resources (skills) and file-based resources
 * (agents, rules, commands, hooks).
 */

import { join, dirname, basename, extname } from 'path';
import { promises as fsNative } from 'fs';

import type { ResourceTypeId } from '../../types/resources.js';
import { getResourceTypeDef, getMarkerFilename } from '../resources/resource-registry.js';
import { renameFrontmatterName } from '../add/entry-renamer.js';
import { discoverResourceFiles } from '../resources/workspace-resource-discovery.js';
import { readTextFile, writeTextFile, exists, ensureDir } from '../../utils/fs.js';
import { MARKDOWN_EXTENSIONS } from '../../constants/index.js';
import { logger } from '../../utils/logger.js';

export interface WorkspaceRenameResult {
  oldPaths: string[];
  newPaths: string[];
  renamedFiles: number;
}

/**
 * Execute a workspace rename of an untracked resource.
 *
 * Discovers resource files across all detected platform directories and renames
 * them in place. For directory-based types (skills), renames the parent directory.
 * For file-based types (agents, etc.), renames individual files.
 *
 * @param resourceType - The resource type id (e.g. 'agent', 'skill')
 * @param resourceName - Current resource name
 * @param newName - Desired new resource name
 * @param targetDir - Workspace root directory
 */
export async function executeWorkspaceRename(
  resourceType: ResourceTypeId,
  resourceName: string,
  newName: string,
  targetDir: string,
): Promise<WorkspaceRenameResult> {
  const typeDef = getResourceTypeDef(resourceType);
  const marker = getMarkerFilename(resourceType);

  const files = await discoverResourceFiles(typeDef, resourceName, targetDir);
  if (files.length === 0) {
    throw new Error(`No files found for resource "${resourceType}/${resourceName}" in workspace.`);
  }

  const oldPaths: string[] = [];
  const newPaths: string[] = [];

  if (marker) {
    // Directory-based resource (e.g. skills/my-skill/ -> skills/new-skill/)
    // Single pass: group files by their resource-named parent directory
    const dirToFiles = new Map<string, string[]>();
    for (const file of files) {
      let current = dirname(file);
      while (current !== targetDir && current !== dirname(current)) {
        if (basename(current) === resourceName) {
          let group = dirToFiles.get(current);
          if (!group) {
            group = [];
            dirToFiles.set(current, group);
          }
          group.push(file);
          break;
        }
        current = dirname(current);
      }
    }

    for (const [oldDir, filesInDir] of dirToFiles) {
      const newDir = join(dirname(oldDir), newName);

      if (await exists(newDir)) {
        throw new Error(`Target directory already exists: ${newDir}`);
      }

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

      // Record old/new paths for each file in this directory
      for (const file of filesInDir) {
        const relativePart = file.slice(oldDir.length);
        oldPaths.push(file);
        newPaths.push(newDir + relativePart);
      }
    }

    logger.info(`Workspace rename (directory): ${resourceName} -> ${newName}`, {
      directories: dirToFiles.size,
      filesRenamed: oldPaths.length,
    });
  } else {
    // File-based resource (e.g. agents/foo.md -> agents/bar.md)
    for (const file of files) {
      const fileName = basename(file);
      const ext = extname(fileName);
      const stem = basename(fileName, ext);

      if (stem !== resourceName) {
        // Non-primary file; keep as-is
        oldPaths.push(file);
        newPaths.push(file);
        continue;
      }

      const newFile = join(dirname(file), `${newName}${ext}`);

      if (await exists(newFile)) {
        throw new Error(`Target file already exists: ${newFile}`);
      }

      // Rename frontmatter in markdown files; plain rename for others
      const extLower = ext.toLowerCase();
      if (MARKDOWN_EXTENSIONS.has(extLower)) {
        const content = await readTextFile(file);
        const updated = renameFrontmatterName(content, newName);
        await writeTextFile(newFile, updated);
        await fsNative.unlink(file);
      } else {
        await fsNative.rename(file, newFile);
      }

      oldPaths.push(file);
      newPaths.push(newFile);
    }

    logger.info(`Workspace rename (file): ${resourceName} -> ${newName}`, {
      filesRenamed: oldPaths.length,
    });
  }

  return {
    oldPaths,
    newPaths,
    renamedFiles: oldPaths.length,
  };
}
