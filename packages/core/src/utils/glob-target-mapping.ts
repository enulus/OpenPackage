import { extname, basename, dirname } from 'path';
import { stripPlatformSuffixFromFilename } from '../core/flows/platform-suffix-handler.js';

function normalizeSlashPath(input: string): string {
  return input.replace(/\\/g, '/');
}

function splitSegments(input: string): string[] {
  const normalized = normalizeSlashPath(input);
  return normalized.split('/').filter(Boolean);
}

/**
 * When mapping a source path into a destination base (e.g. `skills/foo.txt` into `.cursor/skills/**`),
 * avoid duplicating overlapping anchor segments (e.g. `.cursor/skills/skills/foo.txt`).
 *
 * This finds the longest overlap where a suffix of `destBase` equals a prefix of `sourceRel`,
 * then strips that prefix from `sourceRel`.
 */
export function stripOverlappingDestBaseFromSource(
  destBase: string,
  sourceRelFromPackage: string
): string {
  const destSegments = splitSegments(destBase);
  const sourceSegments = splitSegments(sourceRelFromPackage);

  const maxOverlap = Math.min(destSegments.length, sourceSegments.length);
  let overlapLen = 0;

  for (let k = maxOverlap; k >= 1; k--) {
    const destSuffix = destSegments.slice(-k).join('/');
    const sourcePrefix = sourceSegments.slice(0, k).join('/');
    if (destSuffix === sourcePrefix) {
      overlapLen = k;
      break;
    }
  }

  return sourceSegments.slice(overlapLen).join('/');
}

function extractTargetExtensionFromRecursiveSuffix(toSuffix: string): string | null {
  const normalized = normalizeSlashPath(toSuffix);
  const match = normalized.match(/(\.[^/]+)$/);
  return match?.[1] ?? null;
}

/**
 * Resolve the workspace-relative target path for patterns containing `**`.
 *
 * - Preserves nested subdirectories from the source.
 * - Prevents accidental duplication when the destination base overlaps the source prefix.
 * - Supports basic extension remapping (e.g. `** / *.md` -> `** / *.mdc`).
 * - Strips platform suffixes from filenames (e.g. `read-specs.claude.md` -> `read-specs.md`).
 */
export function resolveRecursiveGlobTargetRelativePath(
  sourceRelFromPackage: string,
  fromPattern: string,
  toPattern: string
): string {
  const toParts = normalizeSlashPath(toPattern).split('**');
  const toBase = toParts[0].replace(/\/$/, '');
  const toSuffix = toParts[1] || '';

  let relativeSubpath = sourceRelFromPackage;

  if (fromPattern.includes('**')) {
    const fromParts = normalizeSlashPath(fromPattern).split('**');
    const fromBase = fromParts[0].replace(/\/$/, '');
    const fromSuffix = fromParts[1] || '';

    if (fromBase) {
      const normalizedSource = normalizeSlashPath(sourceRelFromPackage);
      relativeSubpath = normalizedSource.startsWith(fromBase + '/')
        ? normalizedSource.slice(fromBase.length + 1)
        : normalizedSource;
    }

    // Handle extension mapping if suffixes specify extensions: /**/*.md -> /**/*.mdc
    if (fromSuffix && toSuffix) {
      const fromExt = fromSuffix.replace(/^\/?\*+/, '');
      const toExt = toSuffix.replace(/^\/?\*+/, '');
      if (fromExt && toExt && fromExt !== toExt) {
        relativeSubpath = relativeSubpath.replace(
          new RegExp(fromExt.replace('.', '\\.') + '$'),
          toExt
        );
      }
    }
  } else {
    // We don't have a recursive `fromPattern`, so preserve the full source path but avoid
    // duplicating any overlapping "anchor" segments with the destination base.
    relativeSubpath = toBase
      ? stripOverlappingDestBaseFromSource(toBase, sourceRelFromPackage)
      : normalizeSlashPath(sourceRelFromPackage);

    const toExt = extractTargetExtensionFromRecursiveSuffix(toSuffix);
    if (toExt && toExt.startsWith('.')) {
      const currentExt = extname(relativeSubpath);
      if (currentExt && currentExt !== toExt) {
        relativeSubpath = relativeSubpath.slice(0, -currentExt.length) + toExt;
      }
    }
  }

  // Strip platform suffix from filename (e.g. read-specs.claude.md -> read-specs.md)
  // This must be done before constructing the final path
  relativeSubpath = stripPlatformSuffixFromFilename(relativeSubpath);

  return toBase ? normalizeSlashPath(`${toBase}/${relativeSubpath}`) : normalizeSlashPath(relativeSubpath);
}

