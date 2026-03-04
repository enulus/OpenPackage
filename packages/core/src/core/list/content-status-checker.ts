/**
 * Content Status Checker
 *
 * Lightweight read-only content comparison for the `list --status` feature.
 * Compares workspace file content against package source to detect modifications.
 *
 * For normal files: hash workspace file vs source file.
 * For merged files: extract package contribution via merge keys, then hash-compare.
 */

import path from 'path';

import { calculateFileHash } from '../../utils/hash-utils.js';
import { readTextFile, exists } from '../../utils/fs.js';
import { getTargetPath, isComplexMapping, isMergedMapping } from '../../utils/workspace-index-helpers.js';
import { extractContentByKeys } from '../save/save-merge-extractor.js';
import { DefaultFlowExecutor } from '../flows/flow-executor.js';
import { mapPlatformFileToUniversal } from '../platform/platform-mapper.js';
import { MARKDOWN_EXTENSIONS } from '../../constants/index.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type { FlowContext } from '../../types/flows.js';
import { logger } from '../../utils/logger.js';

export type ContentStatus = 'modified' | 'clean' | 'outdated' | 'diverged' | 'merged';

/**
 * Check content status for all tracked files in a package.
 *
 * @param targetDir - Workspace root directory
 * @param packageSourceRoot - Absolute path to package source directory
 * @param filesMapping - Workspace index file mappings for this package
 * @returns Map keyed by "sourceKey::targetPath" → ContentStatus
 */
export async function checkContentStatus(
  targetDir: string,
  packageSourceRoot: string,
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>
): Promise<Map<string, ContentStatus>> {
  const results = new Map<string, ContentStatus>();

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
        const absSource = path.join(packageSourceRoot, sourceKey);

        if (installHash) {
          const status = await checkThreeWayStatus(absTarget, absSource, installHash, targetDir);
          results.set(key, status);
        } else {
          const status = await checkLegacyStatus(absTarget, absSource, targetDir);
          results.set(key, status);
        }
      }
    }
  }

  return results;
}

/**
 * Compute the hash of a source file as it would appear after install.
 *
 * For markdown files deployed to a platform directory, runs the source through
 * the flow executor's own loadSourceFile → serializeTargetContent path — the
 * same code the installer uses.  This accounts for platform frontmatter merge,
 * YAML re-serialization, and any future install-time transforms without
 * maintaining a separate replica of the pipeline.
 */
async function computeSourceHash(
  absSourcePath: string,
  absWorkspacePath: string,
  targetDir: string
): Promise<string> {
  const ext = path.extname(absSourcePath).toLowerCase();

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    try {
      const platformInfo = mapPlatformFileToUniversal(absWorkspacePath, targetDir);
      const executor = new DefaultFlowExecutor();
      const context: FlowContext = {
        workspaceRoot: targetDir,
        packageRoot: path.dirname(absSourcePath),
        platform: platformInfo?.platform ?? 'claude',
        packageName: '',
        direction: 'install',
        variables: {}
      };
      const loaded = await executor.loadSourceFile(absSourcePath, context);
      const serialized = executor.serializeTargetContent(loaded.data, loaded.format);
      return calculateFileHash(serialized);
    } catch {
      const sourceContent = await readTextFile(absSourcePath);
      return calculateFileHash(sourceContent);
    }
  }

  const sourceContent = await readTextFile(absSourcePath);
  return calculateFileHash(sourceContent);
}

/**
 * Three-way status check using the install-time hash as pivot.
 *
 * Compares workspace and source against the stored install hash to determine
 * which side(s) changed since the last install.
 */
async function checkThreeWayStatus(
  absWorkspacePath: string,
  absSourcePath: string,
  installHash: string,
  targetDir: string
): Promise<ContentStatus> {
  try {
    const workspaceContent = await readTextFile(absWorkspacePath);
    const workspaceHash = await calculateFileHash(workspaceContent);
    const workspaceChanged = workspaceHash !== installHash;

    // If source is missing, only workspace side matters
    if (!(await exists(absSourcePath))) {
      return workspaceChanged ? 'modified' : 'clean';
    }

    const sourceHash = await computeSourceHash(absSourcePath, absWorkspacePath, targetDir);
    const sourceChanged = sourceHash !== installHash;

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
 * Legacy two-way status check when no install hash is available.
 *
 * Without an install-time pivot we cannot tell which side changed,
 * so any difference is reported as 'diverged'.
 */
async function checkLegacyStatus(
  absWorkspacePath: string,
  absSourcePath: string,
  targetDir: string
): Promise<ContentStatus> {
  try {
    if (!(await exists(absSourcePath))) {
      return 'clean';
    }

    const workspaceContent = await readTextFile(absWorkspacePath);
    const workspaceHash = await calculateFileHash(workspaceContent);
    const sourceHash = await computeSourceHash(absSourcePath, absWorkspacePath, targetDir);

    return workspaceHash === sourceHash ? 'clean' : 'diverged';
  } catch (error) {
    logger.debug(`Legacy content check failed for ${absWorkspacePath}: ${error}`);
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
