/**
 * Entry Renamer
 *
 * Pure utility for `--as` — rewrites `registryPath` in entries
 * and optionally updates frontmatter `name`.
 */

import { basename, dirname, extname } from 'path';

import { MARKDOWN_EXTENSIONS } from '../../constants/index.js';
import { getSingularTypeFromDir, getMarkerFilename } from '../resources/resource-registry.js';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../flows/markdown.js';
import { readTextFile } from '../../utils/fs.js';
import type { SourceEntry } from './source-collector.js';

/**
 * Validate that an `--as` name is a bare resource name (no slash, dot, or whitespace).
 */
export function validateAsName(name: string): void {
  if (name.includes('/')) {
    throw new Error(`Invalid --as name "${name}": must be a bare name without slashes.`);
  }
  if (name.includes('.')) {
    throw new Error(`Invalid --as name "${name}": must be a bare name without dots (extension is preserved automatically).`);
  }
  if (/\s/.test(name)) {
    throw new Error(`Invalid --as name "${name}": must not contain whitespace.`);
  }
}

/**
 * Rewrite frontmatter `name` field if present. Returns original content unchanged
 * if there is no frontmatter or no `name` field.
 */
export function renameFrontmatterName(content: string, newName: string): string {
  const parsed = parseMarkdownDocument(content, { lenient: true });
  if (!parsed.frontmatter || parsed.frontmatter.name === undefined) {
    return content;
  }
  const updated = { ...parsed.frontmatter, name: newName };
  return serializeMarkdownDocument({ frontmatter: updated, body: parsed.body });
}

/**
 * Rewrite registryPaths in entries to replace the resource name with `newName`.
 * Also reads source files and applies frontmatter name rewriting.
 *
 * - File-based types (agents, rules, commands, hooks): `agents/foo.md` → `agents/bar.md`
 * - Directory-based types (skills): `skills/foo/SKILL.md` → `skills/bar/SKILL.md`
 */
export async function renameEntries(
  entries: SourceEntry[],
  resourceName: string,
  newName: string
): Promise<SourceEntry[]> {
  const result: SourceEntry[] = [];

  for (const entry of entries) {
    const parts = entry.registryPath.split('/');
    const typeDir = parts[0]; // e.g. "agents", "skills"
    const typeId = getSingularTypeFromDir(typeDir);
    const marker = typeId ? getMarkerFilename(typeId) : null;

    let newRegistryPath: string;

    if (marker) {
      // Directory-based (e.g. skills): replace the directory name component
      // skills/foo/SKILL.md → skills/bar/SKILL.md
      // skills/foo/sub/file.md → skills/bar/sub/file.md
      if (parts.length >= 2 && parts[1] === resourceName) {
        parts[1] = newName;
      }
      newRegistryPath = parts.join('/');
    } else {
      // File-based (e.g. agents): replace the resource name in the filename stem
      // agents/foo.md → agents/bar.md
      const fileName = basename(entry.registryPath);
      const ext = extname(fileName);
      const stem = basename(fileName, ext);

      if (stem === resourceName) {
        const dir = dirname(entry.registryPath);
        newRegistryPath = dir === '.' ? `${newName}${ext}` : `${dir}/${newName}${ext}`;
      } else {
        newRegistryPath = entry.registryPath;
      }
    }

    // Read source file and apply frontmatter name rewrite.
    // Always propagate content once read to avoid a double read in copyFilesWithConflictResolution.
    let content: string | undefined;
    const ext = extname(entry.sourcePath).toLowerCase();
    if (MARKDOWN_EXTENSIONS.has(ext)) {
      try {
        const raw = entry.content ?? await readTextFile(entry.sourcePath);
        content = renameFrontmatterName(raw, newName);
      } catch {
        // If read fails, skip content override — copyFilesWithConflictResolution will handle it
      }
    }

    result.push({
      ...entry,
      registryPath: newRegistryPath,
      ...(content !== undefined ? { content } : {}),
    });
  }

  return result;
}
