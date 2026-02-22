import { join } from 'path';
import { getTargetPath } from './workspace-index-helpers.js';

import type { WorkspaceIndex, WorkspaceIndexPackage } from '../types/workspace-index.js';
import { normalizePathForProcessing } from './path-normalization.js';
import { exists, walkFiles } from './fs.js';

export interface WorkspaceConflictOwner {
  packageName: string;
  key: string;
  type: 'file' | 'dir';
}

export interface WorkspaceOwnershipContext {
  /**
   * Directory-key owners (key ends with "/").
   * Each key may have multiple owners, though consumers typically expect none or one.
   */
  dirKeyOwners: Map<string, WorkspaceConflictOwner[]>;
  /**
   * Concrete workspace path → owning package.
   */
  installedPathOwners: Map<string, WorkspaceConflictOwner>;
}

export function getWorkspaceIndexEntry(
  index: WorkspaceIndex,
  packageName: string
): WorkspaceIndexPackage | undefined {
  return index.packages?.[packageName];
}

export function upsertWorkspaceIndexEntry(
  index: WorkspaceIndex,
  packageName: string,
  entry: WorkspaceIndexPackage
): void {
  if (!index.packages) {
    index.packages = {};
  }
  index.packages[packageName] = entry;
}

export function removeWorkspaceIndexEntry(index: WorkspaceIndex, packageName: string): void {
  if (index.packages && index.packages[packageName]) {
    delete index.packages[packageName];
  }
}

export function removeWorkspaceIndexFileKeys(
  index: WorkspaceIndex,
  packageName: string,
  sourceKeysToRemove: Set<string>
): void {
  const pkg = index.packages?.[packageName];
  if (!pkg) return;

  for (const key of sourceKeysToRemove) {
    delete pkg.files[key];
  }

  if (Object.keys(pkg.files).length === 0) {
    delete index.packages[packageName];
  }
}

/**
 * Build ownership maps from the unified workspace index.
 *
 * - Directory keys (trailing "/") are expanded to the concrete file paths that
 *   currently exist on disk under the mapped directories.
 * - File keys map directly to the listed workspace-relative paths.
 */
export async function buildWorkspaceOwnershipContext(
  cwd: string,
  index: WorkspaceIndex,
  opts: { excludePackage?: string } = {}
): Promise<WorkspaceOwnershipContext> {
  const dirKeyOwners = new Map<string, WorkspaceConflictOwner[]>();
  const installedPathOwners = new Map<string, WorkspaceConflictOwner>();

  const packages = index.packages ?? {};
  const exclude = opts.excludePackage;

  for (const [rawName, pkg] of Object.entries(packages)) {
    if (exclude && rawName === exclude) continue;
    if (!pkg || typeof pkg !== 'object') continue;

    const pkgName = rawName;
    const files = pkg.files ?? {};

    for (const [rawKey, rawValues] of Object.entries(files)) {
      if (!Array.isArray(rawValues)) continue;
      const normalizedKey = normalizePathForProcessing(rawKey);
      if (!normalizedKey) continue;

      const owner: WorkspaceConflictOwner = {
        packageName: pkgName,
        key: normalizedKey,
        type: normalizedKey.endsWith('/') ? 'dir' : 'file'
      };

      if (owner.type === 'dir') {
        if (!dirKeyOwners.has(normalizedKey)) {
          dirKeyOwners.set(normalizedKey, []);
        }
        dirKeyOwners.get(normalizedKey)!.push(owner);

        for (const rawMapping of rawValues) {
          // Handle both simple string and WorkspaceIndexFileMapping
          const targetPath = typeof rawMapping === 'string' ? rawMapping : rawMapping.target;
          const dirRel = normalizePathForProcessing(targetPath);
          if (!dirRel) continue;
          const expanded = await collectFilesUnderDirectory(cwd, dirRel);
          for (const relFile of expanded) {
            if (!installedPathOwners.has(relFile)) {
              installedPathOwners.set(relFile, owner);
            }
          }
        }
        continue;
      }

      // file key
      for (const rawMapping of rawValues) {
        // Handle both simple string and WorkspaceIndexFileMapping
        const targetPath = typeof rawMapping === 'string' ? rawMapping : rawMapping.target;
        const relPath = normalizePathForProcessing(targetPath);
        if (!relPath) continue;
        if (!installedPathOwners.has(relPath)) {
          installedPathOwners.set(relPath, owner);
        }
      }
    }
  }

  return { dirKeyOwners, installedPathOwners };
}

async function collectFilesUnderDirectory(cwd: string, dirRel: string): Promise<string[]> {
  const normalizedDir = normalizePathForProcessing(dirRel);
  if (!normalizedDir) return [];

  const absDir = join(cwd, normalizedDir);
  if (!(await exists(absDir))) {
    return [];
  }

  const collected: string[] = [];
  for await (const absFile of walkFiles(absDir)) {
    const rel = normalizePathForProcessing(absFile.slice(absDir.length + 1));
    if (rel) {
      collected.push(normalizePathForProcessing(join(normalizedDir, rel)));
    }
  }
  return collected;
}
