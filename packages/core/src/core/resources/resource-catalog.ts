import type { ResourceTypeId } from './resource-registry.js';

export type ResourceOrigin = 'installed' | 'source';

export interface ResourceFileRef {
  sourceKey?: string;
  target?: string;
  filePath?: string;
  exists?: boolean;
}

export interface ResourceEntry {
  origin: ResourceOrigin;
  resourceType: ResourceTypeId;
  name: string;
  description?: string;
  version?: string;
  installKind?: 'file' | 'directory';
  resourcePath?: string;
  files: ResourceFileRef[];
}

export interface ResourceCatalog {
  all: ResourceEntry[];
  byType: Map<ResourceTypeId, ResourceEntry[]>;
  total: number;
}

export function buildCatalogByType(entries: ResourceEntry[]): Map<ResourceTypeId, ResourceEntry[]> {
  const map = new Map<ResourceTypeId, ResourceEntry[]>();
  for (const entry of entries) {
    let group = map.get(entry.resourceType);
    if (!group) {
      group = [];
      map.set(entry.resourceType, group);
    }
    group.push(entry);
  }
  return map;
}

export function createCatalog(entries: ResourceEntry[]): ResourceCatalog {
  return {
    all: entries,
    byType: buildCatalogByType(entries),
    total: entries.length,
  };
}
