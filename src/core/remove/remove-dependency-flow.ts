import { removeDependencyFromManifest } from '../../utils/package-management.js';
import { logger } from '../../utils/logger.js';

export interface RemoveDependencyResult {
  packageName: string;
  targetManifest: string;
  dependencyName: string;
  removed: boolean;
}

/**
 * Remove a dependency from a package manifest.
 * Mirrors add-dependency-flow for consistency.
 *
 * @param manifestPath - Absolute path to openpackage.yml
 * @param dependencyName - User-specified name (e.g. essential-agent, .opencode)
 * @param packageName - Display name for the package (for logging/result)
 * @returns Result with removal status
 */
export async function runRemoveDependencyFlow(
  manifestPath: string,
  dependencyName: string,
  packageName: string
): Promise<RemoveDependencyResult> {
  const removed = await removeDependencyFromManifest(manifestPath, dependencyName);

  logger.info(
    removed ? `Removed ${dependencyName} from ${manifestPath}` : `No matching dependency found for ${dependencyName}`
  );

  return {
    packageName,
    targetManifest: manifestPath,
    dependencyName,
    removed
  };
}
