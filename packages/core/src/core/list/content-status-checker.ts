/**
 * Content Status Checker
 *
 * Lightweight read-only content comparison for the `list --status` feature.
 * Compares workspace file content against package source to detect modifications.
 *
 * Uses dual hashes stored at install time:
 * - `hash`: xxhash3 of the workspace file written at install (workspace-side pivot)
 * - `sourceHash`: xxhash3 of the raw source file at install (source-side pivot)
 *
 * For merged files: extract package contribution via merge keys, then hash-compare.
 */

import path from 'path';

import { calculateFileHash } from '../../utils/hash-utils.js';
import { readTextFile, exists } from '../../utils/fs.js';
import { getTargetPath, isComplexMapping, isMergedMapping } from '../../utils/workspace-index-helpers.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { extractContentByKeys } from '../save/save-merge-extractor.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import { logger } from '../../utils/logger.js';

export type ContentStatus = 'modified' | 'clean' | 'outdated' | 'diverged' | 'merged' | 'source-deleted';

export interface ContentStatusResult {
  statusMap: Map<string, ContentStatus>;
  pendingHashUpdates: Map<string, { hash?: string; sourceHash?: string }>;
}

/**
 * Check content status for all tracked files in a package.
 *
 * @param targetDir - Workspace root directory
 * @param packageSourceRoot - Absolute path to package source directory
 * @param filesMapping - Workspace index file mappings for this package
 * @returns ContentStatusResult with status map and any pending hash updates
 */
export async function checkContentStatus(
  targetDir: string,
  packageSourceRoot: string,
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>
): Promise<ContentStatusResult> {
  const results = new Map<string, ContentStatus>();
  const pendingHashUpdates = new Map<string, { hash?: string; sourceHash?: string }>();

  for (const [sourceKey, targets] of Object.entries(filesMapping)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;

    for (const mapping of targets) {
      const targetPath = getTargetPath(mapping);
      const key = `${sourceKey}::${targetPath}`;
      const absTarget = path.join(targetDir, targetPath);

      // Skip if workspace file doesn't exist (it's missing, not modified/clean)
      if (!(await exists(absTarget))) continue;

      const isMerged: boolean = isMergedMapping(mapping);

      if (isMerged) {
        const status = await checkMergedFileStatus(
          absTarget,
          path.join(packageSourceRoot, sourceKey),
          (mapping as WorkspaceIndexFileMapping).keys!
        );
        results.set(key, status);
      } else {
        const installHash = isComplexMapping(mapping) ? mapping.hash : undefined;
        const installSourceHash = isComplexMapping(mapping) ? mapping.sourceHash : undefined;
        const absSource = path.join(packageSourceRoot, sourceKey);

        if (installHash) {
          const status = await checkThreeWayStatus(absTarget, absSource, installHash, installSourceHash);
          results.set(key, status);

          // Back-fill missing sourceHash for pre-migration data
          if (!installSourceHash && (await exists(absSource))) {
            try {
              const sourceContent = await readTextFile(absSource);
              pendingHashUpdates.set(key, { sourceHash: await calculateFileHash(sourceContent) });
            } catch { /* best-effort */ }
          }
        } else {
          // No install-time hash — compute current state as baseline (hash pivot recovery)
          results.set(key, 'clean');
          try {
            const workspaceContent = await readTextFile(absTarget);
            const computedHash = await calculateFileHash(workspaceContent);
            const pivot: { hash?: string; sourceHash?: string } = { hash: computedHash };
            if (await exists(absSource)) {
              const sourceContent = await readTextFile(absSource);
              pivot.sourceHash = await calculateFileHash(sourceContent);
            }
            pendingHashUpdates.set(key, pivot);
          } catch {
            // Best-effort — if we can't compute, skip
          }
        }
      }
    }
  }

  return { statusMap: results, pendingHashUpdates };
}

/**
 * Three-way status check using dual install-time hashes.
 *
 * Compares workspace content against `installHash` (workspace-side pivot)
 * and source content against `installSourceHash` (source-side pivot).
 * When `installSourceHash` is absent (pre-migration data), treats source as unchanged.
 */
async function checkThreeWayStatus(
  absWorkspacePath: string,
  absSourcePath: string,
  installHash: string,
  installSourceHash?: string
): Promise<ContentStatus> {
  try {
    const workspaceContent = await readTextFile(absWorkspacePath);
    const workspaceHash = await calculateFileHash(workspaceContent);
    const workspaceChanged = workspaceHash !== installHash;

    // If source is missing and we have proof it existed at install time, it was deleted
    if (!(await exists(absSourcePath))) {
      if (installSourceHash) return 'source-deleted';
      return workspaceChanged ? 'modified' : 'clean';
    }

    // Without installSourceHash (pre-migration), we can't detect source changes
    if (!installSourceHash) {
      return workspaceChanged ? 'modified' : 'clean';
    }

    const sourceContent = await readTextFile(absSourcePath);
    const sourceHash = await calculateFileHash(sourceContent);
    const sourceChanged = sourceHash !== installSourceHash;

    if (!workspaceChanged && !sourceChanged) return 'clean';
    if (workspaceChanged && !sourceChanged) return 'modified';
    if (!workspaceChanged && sourceChanged) return 'outdated';
    return 'diverged';
  } catch (error) {
    logger.debug(`Three-way check failed for ${absWorkspacePath}: ${error}`);
    return 'clean';
  }
}

/**
 * Compare a merged file: extract package contribution from both workspace
 * and source using merge keys, then hash-compare.
 * Falls back to 'merged' if extraction fails.
 */
async function checkMergedFileStatus(
  absWorkspacePath: string,
  absSourcePath: string,
  mergeKeys: string[]
): Promise<ContentStatus> {
  try {
    if (!(await exists(absSourcePath))) {
      return 'merged';
    }

    const [workspaceContent, sourceContent] = await Promise.all([
      readTextFile(absWorkspacePath),
      readTextFile(absSourcePath)
    ]);

    const [workspaceExtract, sourceExtract] = await Promise.all([
      extractContentByKeys(workspaceContent, mergeKeys),
      extractContentByKeys(sourceContent, mergeKeys)
    ]);

    if (!workspaceExtract.success || !sourceExtract.success) {
      return 'merged';
    }

    return workspaceExtract.extractedHash === sourceExtract.extractedHash ? 'clean' : 'modified';
  } catch (error) {
    logger.debug(`Merged content check failed for ${absWorkspacePath}: ${error}`);
    return 'merged';
  }
}

/**
 * Apply pending hash updates to the workspace index.
 *
 * Reads the index, finds matching mappings by sourceKey::targetPath key,
 * and upgrades them from string → object form if needed, then sets hash/sourceHash.
 * Writes atomically via writeWorkspaceIndex.
 */
export async function applyPendingHashUpdates(
  targetDir: string,
  packageName: string,
  pendingUpdates: Map<string, { hash?: string; sourceHash?: string }>,
): Promise<void> {
  if (pendingUpdates.size === 0) return;

  const record = await readWorkspaceIndex(targetDir);
  const pkg = record.index.packages?.[packageName];
  if (!pkg?.files) return;

  let updated = false;

  for (const [compositeKey, update] of pendingUpdates) {
    const separatorIdx = compositeKey.indexOf('::');
    if (separatorIdx === -1) continue;

    const sourceKey = compositeKey.slice(0, separatorIdx);
    const targetPath = compositeKey.slice(separatorIdx + 2);

    const targets = pkg.files[sourceKey];
    if (!Array.isArray(targets)) continue;

    for (let i = 0; i < targets.length; i++) {
      const mapping = targets[i];
      const mappingTarget = getTargetPath(mapping);
      if (mappingTarget !== targetPath) continue;

      if (isComplexMapping(mapping)) {
        if (update.hash) mapping.hash = update.hash;
        if (update.sourceHash) mapping.sourceHash = update.sourceHash;
      } else {
        // Upgrade string → object form
        const upgraded: WorkspaceIndexFileMapping = { target: mapping as string };
        if (update.hash) upgraded.hash = update.hash;
        if (update.sourceHash) upgraded.sourceHash = update.sourceHash;
        targets[i] = upgraded;
      }
      updated = true;
      break;
    }
  }

  if (updated) {
    await writeWorkspaceIndex(record);
    logger.debug(`Applied ${pendingUpdates.size} hash pivot update(s) for ${packageName}`);
  }
}
