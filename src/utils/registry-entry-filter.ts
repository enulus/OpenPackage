import {
  DIR_PATTERNS,
  FILE_PATTERNS
} from '../constants/index.js';
import { isRootCopyPath } from './platform-root-files.js';
import {
  getFirstPathComponent,
  getPathAfterFirstComponent,
  normalizePathForProcessing
} from './path-normalization.js';
import { getPlatformRootFiles, getAllUniversalSubdirs, isPlatformId } from '../core/platforms.js';
import { isManifestPath } from './manifest-paths.js';

const ROOT_REGISTRY_FILE_NAMES = getPlatformRootFiles();
export function normalizeRegistryPath(registryPath: string): string {
  return normalizePathForProcessing(registryPath);
}

export function isRootRegistryPath(registryPath: string): boolean {
  const normalized = normalizeRegistryPath(registryPath);
  return ROOT_REGISTRY_FILE_NAMES.some(pattern =>
    normalized.endsWith(`/${pattern}`) || normalized === pattern
  );
}

export function isSkippableRegistryPath(registryPath: string): boolean {
  const normalized = normalizeRegistryPath(registryPath);
  
  // Handle openpackage.yml at any level
  if (isManifestPath(normalized)) {
    return true;
  }

  const universalInfo = extractUniversalSubdirInfo(normalized);
  if (!universalInfo) {
    return false;
  }

  const normalizedRel = normalizePathForProcessing(universalInfo.relPath);
  if (!normalizedRel.endsWith(FILE_PATTERNS.YML_FILE)) {
    return false;
  }

  const fileName = normalizedRel.split('/').pop();
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

export function isAllowedRegistryPath(registryPath: string): boolean {
  const normalized = normalizeRegistryPath(registryPath);

  if (isRootRegistryPath(normalized)) return false;
  if (isSkippableRegistryPath(normalized)) return false;

  // Reject copy-to-root entries here; they are handled explicitly elsewhere
  if (isRootCopyPath(normalized)) return false;

  // Strict v2: only accept paths whose first component is a universal subdir
  const universalInfo = extractUniversalSubdirInfo(normalized);
  return Boolean(universalInfo);
}

export function extractUniversalSubdirInfo(
  registryPath: string,
  cwd?: string
): { universalSubdir: string; relPath: string } | null {
  const normalized = normalizeRegistryPath(registryPath);

  // Strict v2: do not accept legacy .openpackage/ prefix
  if (normalized.startsWith(`${DIR_PATTERNS.OPENPACKAGE}/`)) {
    return null;
  }

  const firstComponent = getFirstPathComponent(normalized);

  const universalSubdirs = getAllUniversalSubdirs(cwd);
  if (!firstComponent || !universalSubdirs.has(firstComponent)) {
    return null;
  }

  const relPath = getPathAfterFirstComponent(normalized) ?? '';
  return {
    universalSubdir: firstComponent,
    relPath
  };
}


