import { removeDependencyFromManifest } from '../package-management.js';
import { logger } from '../../utils/logger.js';

export interface RemoveDependencyResult {
  packageName: string;
  targetManifest: string;
  dependencyName: string;
  removed: boolean;
  section?: 'dependencies' | 'dev-dependencies';
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
  const result = await removeDependencyFromManifest(manifestPath, dependencyName);

  logger.info(
    result.removed ? `Removed ${dependencyName} from ${manifestPath}` : `No matching dependency found for ${dependencyName}`
  );

  return {
    packageName,
    targetManifest: manifestPath,
    dependencyName,
    removed: result.removed,
    section: result.section
  };
}
