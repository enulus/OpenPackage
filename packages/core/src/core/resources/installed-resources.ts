import path from 'path';
import { classifySourceKey } from './source-key-classifier.js';
import type { ResourceCatalog, ResourceEntry, ResourceFileRef } from './resource-catalog.js';
import { createCatalog } from './resource-catalog.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import { exists } from '../../utils/fs.js';
import type { WorkspaceIndexPackage } from '../../types/workspace-index.js';

export async function buildInstalledResourceCatalog(
  pkgEntry: WorkspaceIndexPackage,
  targetDir: string
): Promise<ResourceCatalog> {
  const entryMap = new Map<string, ResourceEntry>();

  for (const [sourceKey, mappings] of Object.entries(pkgEntry.files || {})) {
    if (!Array.isArray(mappings) || mappings.length === 0) {
      continue;
    }

    const { resourceType, resourceName } = classifySourceKey(sourceKey);
    const mapKey = `${resourceType}:${resourceName}`;

    let entry = entryMap.get(mapKey);
    if (!entry) {
      entry = {
        origin: 'installed',
        resourceType,
        name: resourceName,
        files: [],
      };
      entryMap.set(mapKey, entry);
    }

    for (const mapping of mappings) {
      const target = getTargetPath(mapping);
      const absPath = path.join(targetDir, target);
      const fileExists = await exists(absPath);
      const fileRef: ResourceFileRef = { sourceKey, target, exists: fileExists };
      entry.files.push(fileRef);
    }
  }

  const entries = [...entryMap.values()];
  return createCatalog(entries);
}
