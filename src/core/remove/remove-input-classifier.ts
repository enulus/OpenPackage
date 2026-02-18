import { join } from 'path';

import { exists, isDirectory, isFile } from '../../utils/fs.js';
import { findMatchingDependencyInManifest } from '../../utils/package-management.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { logger } from '../../utils/logger.js';

export type RemoveMode = 'file' | 'dependency';

export type RemoveInputClassification =
  | { mode: 'file'; path: string }
  | { mode: 'dependency'; dependencyName: string };

/**
 * Classify remove command input to determine mode (file vs. dependency) and extract metadata.
 *
 * Resolution rules:
 * - `./path` or `../path`: Explicit path syntax → file only (no dependency check)
 * - Bare names: Dependency-first resolution; if both dep and file match, prefer dependency
 *
 * @param pathArg - User input (e.g. essential-agent, ./essential-agent, agents/essential-agent.md)
 * @param packageRootDir - Absolute path to package source directory
 * @param manifestPath - Absolute path to openpackage.yml
 * @returns Classification or null if neither file nor dependency matches
 */
export async function classifyRemoveInput(
  pathArg: string,
  packageRootDir: string,
  manifestPath: string
): Promise<RemoveInputClassification | null> {
  const normalizedPath = normalizePathForProcessing(pathArg) || pathArg;
  const targetPath = join(packageRootDir, normalizedPath);

  const pathExists = await exists(targetPath);
  const hasFileMatch =
    pathExists &&
    ((await isFile(targetPath)) || (await isDirectory(targetPath)));

  // Explicit path (./ or ../) → file only, skip dependency lookup
  if (pathArg.startsWith('./') || pathArg.startsWith('../')) {
    if (hasFileMatch) {
      logger.debug('Classified explicit path as file', {
        pathArg,
        targetPath
      });
      return { mode: 'file', path: normalizedPath };
    }
    return null;
  }

  // Bare names: dependency-first resolution
  const matchedDependency = await findMatchingDependencyInManifest(manifestPath, pathArg);

  if (matchedDependency) {
    logger.debug('Classified remove input as dependency', {
      pathArg,
      dependencyName: matchedDependency
    });
    return { mode: 'dependency', dependencyName: matchedDependency };
  }

  if (hasFileMatch) {
    logger.debug('Classified remove input as file', {
      pathArg,
      targetPath
    });
    return { mode: 'file', path: normalizedPath };
  }

  return null;
}
