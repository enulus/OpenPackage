/**
 * Flow-Aware Uninstaller
 * 
 * Handles uninstallation of packages installed with flows,
 * including precise removal of keys from merged files.
 */

import { join } from 'path';
import { readTextFile, writeTextFile, exists, remove } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import { deleteNestedKey, isEffectivelyEmpty } from '../flows/flow-key-extractor.js';
import yaml from 'js-yaml';
import * as TOML from 'smol-toml';

/**
 * File format detection
 */
type FileFormat = 'json' | 'jsonc' | 'yaml' | 'yml' | 'toml' | 'text';

function detectFileFormat(filePath: string): FileFormat {
  const ext = filePath.toLowerCase().split('.').pop();
  switch (ext) {
    case 'json':
      return 'json';
    case 'jsonc':
      return 'jsonc';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'toml':
      return 'toml';
    default:
      return 'text';
  }
}

/**
 * Parse file content based on format
 */
function parseContent(content: string, format: FileFormat): any {
  try {
    switch (format) {
      case 'json':
      case 'jsonc':
        // Strip comments for JSONC
        const cleaned = format === 'jsonc' 
          ? content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
          : content;
        return JSON.parse(cleaned);
      
      case 'yaml':
      case 'yml':
        return yaml.load(content);
      
      case 'toml':
        return TOML.parse(content);
      
      default:
        return content;
    }
  } catch (error) {
    throw new Error(`Failed to parse ${format} file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Serialize content based on format
 */
function serializeContent(data: any, format: FileFormat): string {
  try {
    switch (format) {
      case 'json':
      case 'jsonc':
        return JSON.stringify(data, null, 2);
      
      case 'yaml':
      case 'yml':
        return yaml.dump(data, { indent: 2, flowLevel: 1, lineWidth: -1 });
      
      case 'toml':
        return TOML.stringify(data);
      
      default:
        return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }
  } catch (error) {
    throw new Error(`Failed to serialize ${format} file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Remove specific keys from a merged file
 * Deletes the file if it becomes empty after removal
 * 
 * @param cwd - Workspace root
 * @param targetPath - Relative path to target file
 * @param keysToRemove - Dot-notated keys to remove
 * @returns true if file was deleted, false if updated
 */
export async function removeKeysFromMergedFile(
  cwd: string,
  targetPath: string,
  keysToRemove: string[]
): Promise<{ deleted: boolean; updated: boolean }> {
  const absPath = join(cwd, targetPath);

  if (!(await exists(absPath))) {
    return { deleted: false, updated: false };
  }

  // Load and parse file
  const content = await readTextFile(absPath);
  const format = detectFileFormat(targetPath);
  let data: any;

  try {
    data = parseContent(content, format);
  } catch (error) {
    logger.warn(`Failed to parse ${targetPath} for key removal: ${error instanceof Error ? error.message : String(error)}`);
    return { deleted: false, updated: false };
  }

  const hasNestedKeyPath = (obj: any, keyPath: string): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    const parts = keyPath.split('.').filter(Boolean);
    let current: any = obj;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || !(part in current)) return false;
      current = current[part];
    }
    return true;
  };

  const existingBefore = keysToRemove.filter(k => typeof k === 'string' && hasNestedKeyPath(data, k)).length;
  // Remove each key
  for (const key of keysToRemove) {
    deleteNestedKey(data, key);
  }

  // Check if file is now empty
  if (isEffectivelyEmpty(data)) {
    await remove(absPath);
    logger.info(`Removed empty file: ${targetPath}`);
    return { deleted: true, updated: false };
  }

  // Write back updated content
  const serialized = serializeContent(data, format);
  await writeTextFile(absPath, serialized);
  logger.info(`Updated ${targetPath}: removed ${keysToRemove.length} keys`);
  return { deleted: false, updated: true };
}

/**
 * Remove a file mapping during uninstall
 * Handles both simple file removal and key-based removal from merged files
 * 
 * @param cwd - Workspace root
 * @param mapping - File mapping from workspace index
 * @param packageName - Package being uninstalled (for logging)
 * @returns Paths that were removed or updated
 */
export async function removeFileMapping(
  cwd: string,
  mapping: string | WorkspaceIndexFileMapping,
  packageName: string
): Promise<{ removed: string[]; updated: string[] }> {
  const removed: string[] = [];
  const updated: string[] = [];

  if (typeof mapping === 'string') {
    // Simple file mapping - delete entire file
    const absPath = join(cwd, mapping);
    if (await exists(absPath)) {
      await remove(absPath);
      removed.push(mapping);
      logger.debug(`Removed file: ${mapping}`);
    }
  } else {
    // Complex mapping with potential key tracking
    const targetPath = mapping.target;

    if (mapping.merge === 'composite') {
      // Composite merge uses delimiters - handled by existing root file logic
      // This is already handled by applyRootFileRemovals
      logger.debug(`Skipping composite merge file (handled by root file logic): ${targetPath}`);
    } else if (mapping.keys && mapping.keys.length > 0) {
      // Remove specific keys from merged file
      const result = await removeKeysFromMergedFile(cwd, targetPath, mapping.keys);
      
      if (result.deleted) {
        removed.push(targetPath);
      } else if (result.updated) {
        updated.push(targetPath);
      }

      logger.debug(
        `Removed ${mapping.keys.length} keys from ${targetPath}: ${mapping.keys.join(', ')}`
      );
    } else if (mapping.merge === 'deep' || mapping.merge === 'shallow') {
      // Merged file but no key tracking - this shouldn't happen with new installs
      logger.warn(
        `Cannot precisely remove ${targetPath} for ${packageName} - no key tracking available. ` +
        `File may contain content from other packages.`
      );
      // Don't delete - safer to leave it
    } else {
      // merge: 'replace' or no merge - delete entire file
      const absPath = join(cwd, targetPath);
      if (await exists(absPath)) {
        await remove(absPath);
        removed.push(targetPath);
        logger.debug(`Removed file: ${targetPath}`);
      }
    }
  }

  return { removed, updated };
}
