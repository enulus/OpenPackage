import {
  FILE_PATTERNS
} from '../constants/index.js';
import { isRootCopyPath } from './platform-root-files.js';
import { normalizePathForProcessing } from './path-normalization.js';
import { 
  matchesUniversalPattern,
  isPlatformId 
} from '../core/platforms.js';
import { isManifestPath } from './manifest-paths.js';
import { isPlatformRootFile } from './platform-utils.js';

export function normalizeRegistryPath(registryPath: string): string {
  return normalizePathForProcessing(registryPath);
}

export function isRootRegistryPath(registryPath: string): boolean {
  const normalized = normalizeRegistryPath(registryPath);
  const fileName = normalized.split('/').pop();
  return !!fileName && isPlatformRootFile(fileName);
}

export function isSkippableRegistryPath(registryPath: string, cwd?: string): boolean {
  const normalized = normalizeRegistryPath(registryPath);
  
  // Handle openpackage.yml at any level
  if (isManifestPath(normalized)) {
    return true;
  }

  // Check if it's a platform-specific YML file (e.g., rules.cursor.yml)
  if (!normalized.endsWith(FILE_PATTERNS.YML_FILE)) {
    return false;
  }

  const fileName = normalized.split('/').pop();
  if (!fileName) {
    return false;
  }

  const parts = fileName.split('.');
  if (parts.length < 3) {
    return false;
  }

  const possiblePlatform = parts[parts.length - 2];
  return isPlatformId(possiblePlatform);
}

/**
 * Check if a registry path is allowed to be included in a package.
 * Uses flow-based pattern matching to determine if a file is universal content.
 * 
 * @param registryPath - Path to validate
 * @param cwd - Optional cwd for local platform config overrides
 * @returns true if path should be included in package
 */
export function isAllowedRegistryPath(registryPath: string, cwd?: string): boolean {
  const normalized = normalizeRegistryPath(registryPath);

  // Root-level platform files (AGENTS.md, CLAUDE.md, etc.) are allowed as package content.
  // They are mapped by platform flows during install/apply.
  if (isRootRegistryPath(normalized)) return true;
  
  // Exclude platform-specific YML files
  if (isSkippableRegistryPath(normalized, cwd)) return false;

  // Exclude copy-to-root entries (handled explicitly elsewhere)
  if (isRootCopyPath(normalized)) return false;

  // Flow-based validation: path must match at least one universal pattern
  return matchesUniversalPattern(normalized, cwd);
}

/**
 * Extract universal subdirectory info from a registry path if it starts with a known subdir.
 * Returns null for root-level files that match universal patterns.
 * 
 * @param registryPath - Registry path to analyze
 * @param cwd - Optional cwd for local platform config overrides
 * @returns Subdirectory info or null
 * 
 * @deprecated This function exists for backward compatibility with code that needs
 * to extract subdirectory information for path mapping. New code should use
 * matchesUniversalPattern() for validation.
 */
export function extractUniversalSubdirInfo(
  registryPath: string,
  cwd?: string
): { universalSubdir: string; relPath: string } | null {
  const normalized = normalizeRegistryPath(registryPath);

  // Must match a universal pattern
  if (!matchesUniversalPattern(normalized, cwd)) {
    return null;
  }

  // Extract first path component
  const parts = normalized.split('/');
  const firstComponent = parts[0];
  
  // If first component contains a dot, it's a root-level file, not a subdir
  if (!firstComponent || firstComponent.includes('.')) {
    return null;
  }

  // First component is a directory
  const relPath = parts.slice(1).join('/');
  return {
    universalSubdir: firstComponent,
    relPath
  };
}


