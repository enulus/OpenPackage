import { normalizePathForProcessing } from '../../../utils/path-normalization.js';
import { DIR_PATTERNS, PACKAGE_PATHS } from '../../../constants/index.js';

/**
 * Validate that target directory is not inside .openpackage metadata.
 * @throws Error if target is inside metadata directory
 */
export function assertTargetDirOutsideMetadata(targetDir: string): void {
  const normalized = normalizePathForProcessing(targetDir ?? '.');
  if (!normalized || normalized === '.') {
    return; // default install root
  }

  if (
    normalized === DIR_PATTERNS.OPENPACKAGE ||
    normalized.startsWith(`${DIR_PATTERNS.OPENPACKAGE}/`)
  ) {
    throw new Error(
      `Installation target '${targetDir}' cannot point inside ${DIR_PATTERNS.OPENPACKAGE} ` +
      `(reserved for metadata like ${PACKAGE_PATHS.INDEX_RELATIVE}). ` +
      `Choose a workspace path outside metadata.`
    );
  }
}
