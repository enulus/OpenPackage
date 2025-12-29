import { normalizePathForProcessing } from './path-normalization.js';
import { DIR_PATTERNS, FILE_PATTERNS, OPENPACKAGE_DIRS } from '../constants/index.js';

const EXCLUDED_DIR_PREFIXES = [
  OPENPACKAGE_DIRS.PACKAGES, // Nested packages are independent units; never copy inline
  // Note: .openpackage/ is excluded separately in the function below (entire directory is workspace-local metadata)
  `${DIR_PATTERNS.OPENPACKAGE}/${OPENPACKAGE_DIRS.PACKAGES}` // Legacy: kept for completeness, but covered by .openpackage/ exclusion in function
];

const EXCLUDED_FILES = new Set<string>([FILE_PATTERNS.OPENPACKAGE_INDEX_YML]);

export function isExcludedFromPackage(relativePath: string): boolean {
  const normalized = normalizePathForProcessing(relativePath);
  if (!normalized) {
    return true;
  }

  // Exclude entire .openpackage/ directory (workspace-local metadata; never part of payload)
  if (normalized === DIR_PATTERNS.OPENPACKAGE || 
      normalized.startsWith(`${DIR_PATTERNS.OPENPACKAGE}/`)) {
    return true;
  }

  const baseName = normalized.split('/').pop();
  if (baseName && EXCLUDED_FILES.has(baseName)) {
    return true;
  }

  return EXCLUDED_DIR_PREFIXES.some(prefix => {
    const normalizedPrefix = normalizePathForProcessing(prefix);
    return (
      normalized === normalizedPrefix ||
      normalized.startsWith(`${normalizedPrefix}/`)
    );
  });
}

