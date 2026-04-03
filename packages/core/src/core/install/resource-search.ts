import { basename, relative } from 'path';
import { walkFiles } from '../../utils/fs.js';
import { WORKSPACE_DISCOVERY_EXCLUDES } from '../../constants/workspace.js';
import { getResourceTypeDef } from '../resources/resource-registry.js';
import type { ResourceTypeId } from '../../types/resources.js';

function hasAncestorDirNamed(basePath: string, filePath: string, dirName: string): boolean {
  const relativePath = relative(basePath, filePath).replace(/\\/g, '/');
  const segments = relativePath.split('/').filter(Boolean);
  return segments.slice(0, -1).includes(dirName);
}

export async function findMarkerResourceFiles(
  basePath: string,
  resourceType: ResourceTypeId
): Promise<string[]> {
  const definition = getResourceTypeDef(resourceType);
  if (!definition.dirName || !definition.marker) {
    return [];
  }

  const files: string[] = [];

  for await (const file of walkFiles(basePath, [], { excludeDirs: WORKSPACE_DISCOVERY_EXCLUDES })) {
    if (basename(file) !== definition.marker) {
      continue;
    }

    if (!hasAncestorDirNamed(basePath, file, definition.dirName)) {
      continue;
    }

    files.push(file);
  }

  return files;
}
