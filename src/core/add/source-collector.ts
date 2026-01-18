import { relative, basename } from 'path';
import { realpathSync } from 'fs';

import { DIR_PATTERNS } from '../../constants/index.js';
import { isDirectory, isFile, walkFiles } from '../../utils/fs.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { mapWorkspaceFileToUniversal } from '../../utils/platform-mapper.js';
import { isPlatformRootFile } from '../../utils/platform-utils.js';

export interface SourceEntry {
  sourcePath: string;
  registryPath: string;
}

/**
 * Collect source entries from a workspace path for adding to a package source.
 * Uses IMPORT flows (workspace → package direction) to map files correctly.
 */
export async function collectSourceEntries(resolvedPath: string, cwd: string): Promise<SourceEntry[]> {
  const entries: SourceEntry[] = [];

  if (await isDirectory(resolvedPath)) {
    for await (const filePath of walkFiles(resolvedPath)) {
      const entry = deriveSourceEntry(filePath, cwd);
      if (!entry) {
        throw new Error(`Unsupported file inside directory: ${relative(cwd, filePath)}`);
      }
      entries.push(entry);
    }
    return entries;
  }

  if (await isFile(resolvedPath)) {
    const entry = deriveSourceEntry(resolvedPath, cwd);
    if (!entry) {
      throw new Error(`Unsupported file: ${relative(cwd, resolvedPath)}`);
    }
    entries.push(entry);
    return entries;
  }

  throw new Error(`Unsupported path type: ${resolvedPath}`);
}

/**
 * Derive a source entry from an absolute file path.
 * Uses IMPORT flows to map workspace files to their universal package paths.
 * 
 * Flow-based mapping:
 * 1. Try to match against platform IMPORT flows (workspace → package)
 * 2. Check if it's a platform root file (AGENTS.md, CLAUDE.md, etc.)
 * 3. Otherwise, treat as root-level content (stored at package root)
 */
function deriveSourceEntry(absFilePath: string, cwd: string): SourceEntry | null {
  // Resolve symlinks to ensure consistent path comparison
  const realFilePath = realpathSync(absFilePath);
  const realCwd = realpathSync(cwd);
  const relativePath = relative(realCwd, realFilePath);
  const normalizedRelPath = normalizePathForProcessing(relativePath);

  // 1. Try to map using platform IMPORT flows (workspace → package direction)
  const mapping = mapWorkspaceFileToUniversal(absFilePath, cwd);
  if (mapping) {
    // Successfully mapped via import flow
    // Construct registry path: subdir/relPath (e.g., "commands/test.md")
    const registryPath = [mapping.subdir, mapping.relPath].filter(Boolean).join('/');
    return {
      sourcePath: absFilePath,
      registryPath
    };
  }

  // 2. Check if this is a platform root file (e.g., AGENTS.md, CLAUDE.md)
  const fileName = basename(normalizedRelPath);
  if (fileName && isPlatformRootFile(fileName) && !normalizedRelPath.includes('/')) {
    // Root files: stored at package root with no prefix
    return {
      sourcePath: absFilePath,
      registryPath: fileName
    };
  }

  // 3. All other files: treat as root-level content
  // These are non-platform-specific files stored at package root under root/
  return {
    sourcePath: absFilePath,
    registryPath: `root/${normalizedRelPath}`
  };
}

