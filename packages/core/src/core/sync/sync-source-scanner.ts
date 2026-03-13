/**
 * Sync Source Scanner
 *
 * Detects files that exist in the package source but are not tracked
 * in the workspace index. This is the opposite direction of
 * save-new-file-detector.ts (source→workspace instead of workspace→source).
 */

import path from 'path';

import { walkFiles } from '../../utils/fs.js';
import { PACKAGE_BOUNDARY_DIRS } from '../../constants/workspace.js';
import {
  isAllowedRegistryPath,
  isSkippableRegistryPath,
  isRootRegistryPath,
  extractUniversalSubdirInfo,
} from '../platform/registry-entry-filter.js';
import { mapUniversalToPlatform } from '../platform/platform-mapper.js';
import { getAllPlatforms } from '../platforms.js';

export interface NewSourceFileEntry {
  /** Registry path (relative to package root) */
  registryPath: string;
  /** Absolute path to the source file */
  absSourcePath: string;
  /** Resolved workspace target paths (one per active platform) */
  targetPaths: string[];
}

/**
 * Detect source files not yet tracked in the workspace index.
 *
 * @param packageRoot - Absolute path to the package source directory
 * @param cwd - Workspace root (used for platform resolution)
 * @param existingSourceKeys - Set of source keys already in the workspace index
 * @returns Array of new source file entries with resolved target paths
 */
export async function detectNewSourceFiles(
  packageRoot: string,
  cwd: string,
  existingSourceKeys: Set<string>,
): Promise<NewSourceFileEntry[]> {
  const newFiles: NewSourceFileEntry[] = [];

  for await (const absFilePath of walkFiles(packageRoot, [], { excludeDirs: PACKAGE_BOUNDARY_DIRS })) {
    const registryPath = path.relative(packageRoot, absFilePath).replace(/\\/g, '/');

    // Skip files that are already tracked
    if (existingSourceKeys.has(registryPath)) continue;

    // Apply registry path filters
    if (isRootRegistryPath(registryPath)) continue;
    if (isSkippableRegistryPath(registryPath, cwd)) continue;
    if (!isAllowedRegistryPath(registryPath, cwd)) continue;

    // Resolve workspace target paths via platform mapping
    const targetPaths = resolveTargetPaths(registryPath, cwd);
    if (targetPaths.length === 0) continue;

    newFiles.push({
      registryPath,
      absSourcePath: absFilePath,
      targetPaths,
    });
  }

  return newFiles;
}

/**
 * Resolve workspace target paths for a universal registry path
 * by mapping through each active platform's export flows.
 */
function resolveTargetPaths(registryPath: string, cwd: string): string[] {
  const subdirInfo = extractUniversalSubdirInfo(registryPath, cwd);
  if (!subdirInfo) return [];

  const platforms = getAllPlatforms(undefined, cwd);
  const paths: string[] = [];

  for (const platform of platforms) {
    try {
      const mapped = mapUniversalToPlatform(platform, subdirInfo.universalSubdir, subdirInfo.relPath, cwd);
      if (mapped.relFile) {
        paths.push(mapped.relFile);
      }
    } catch {
      // Platform doesn't support this subdir — skip
    }
  }

  return paths;
}
