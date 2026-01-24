import { DIR_PATTERNS } from '../constants/index.js';
import { getAllUniversalSubdirs } from '../core/platforms.js';

export function formatRegistryPathForDisplay(registryPath: string, cwd?: string): string {
  const universalSubdirs = getAllUniversalSubdirs(cwd);
  const firstComponent = registryPath.split('/')[0];

  if (firstComponent && universalSubdirs.has(firstComponent)) {
    return `${DIR_PATTERNS.OPENPACKAGE}/${registryPath}`;
  }

  return registryPath;
}


