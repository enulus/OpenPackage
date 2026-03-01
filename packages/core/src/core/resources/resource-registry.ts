import type { ResourceTypeId, InstallableResourceTypeId, ResourceTypeDef } from '../../types/resources.js';
export type { ResourceTypeId, InstallableResourceTypeId, ResourceTypeDef };

import { DIR_TO_TYPE } from '../../constants/index.js';
export { DIR_TO_TYPE };

const DEFINITIONS: readonly ResourceTypeDef[] = [
  { id: 'rule',    dirName: 'rules',    marker: null,         labelPlural: 'Rules',              pluralKey: 'rules',    order: 0, installable: true  },
  { id: 'agent',   dirName: 'agents',   marker: null,         labelPlural: 'Agents',             pluralKey: 'agents',   order: 1, installable: true  },
  { id: 'command', dirName: 'commands', marker: null,         labelPlural: 'Commands',           pluralKey: 'commands', order: 2, installable: true  },
  { id: 'skill',   dirName: 'skills',   marker: 'SKILL.md',  labelPlural: 'Skills',             pluralKey: 'skills',   order: 3, installable: true  },
  { id: 'hook',    dirName: 'hooks',    marker: null,         labelPlural: 'Hooks',              pluralKey: 'hooks',    order: 4, installable: true  },
  { id: 'mcp',     dirName: null,       marker: null,         labelPlural: 'MCP Servers',        pluralKey: 'mcps',     order: 5, installable: true  },
  { id: 'other',   dirName: null,       marker: null,         labelPlural: 'Other',              pluralKey: 'other',    order: 6, installable: false },
] as const;

const BY_ID = new Map<ResourceTypeId, ResourceTypeDef>(
  DEFINITIONS.map(d => [d.id, d])
);

const NORMALIZE_MAP: Record<string, ResourceTypeId> = {};
for (const def of DEFINITIONS) {
  NORMALIZE_MAP[def.id] = def.id;
  NORMALIZE_MAP[def.pluralKey] = def.id;
  if (def.dirName) {
    NORMALIZE_MAP[def.dirName] = def.id;
  }
}

export const RESOURCE_TYPES: readonly ResourceTypeDef[] = DEFINITIONS;

export const RESOURCE_TYPE_ORDER: readonly ResourceTypeId[] = DEFINITIONS.map(d => d.id);

export const RESOURCE_TYPE_ORDER_PLURAL: readonly string[] = DEFINITIONS.map(d => d.pluralKey);

export function getResourceTypeDef(id: ResourceTypeId): ResourceTypeDef {
  return BY_ID.get(id)!;
}

export function normalizeType(input: string): ResourceTypeId {
  const lower = input.toLowerCase();
  return NORMALIZE_MAP[lower] ?? 'other';
}

export function toPluralKey(id: ResourceTypeId): string {
  return BY_ID.get(id)?.pluralKey ?? 'other';
}

export function toLabelPlural(id: ResourceTypeId): string {
  return BY_ID.get(id)?.labelPlural ?? 'Other';
}

export function getInstallableTypes(): ResourceTypeDef[] {
  return DEFINITIONS.filter(d => d.installable) as ResourceTypeDef[];
}

export function getSingularTypeFromDir(dirName: string): ResourceTypeId | undefined {
  return DIR_TO_TYPE[dirName];
}

// ---------------------------------------------------------------------------
// Marker boundary utilities
// ---------------------------------------------------------------------------

/**
 * Get the marker filename for a resource type, or null if none.
 */
export function getMarkerFilename(id: ResourceTypeId): string | null {
  return BY_ID.get(id)?.marker ?? null;
}

/**
 * Find the index of a marker filename within path segments.
 * Returns -1 if the marker is not found.
 *
 * This is the single source of truth for the algorithm:
 * "a marker-based resource boundary is the parent directory of the marker file."
 */
export function findMarkerIndex(pathSegments: string[], marker: string): number {
  return pathSegments.indexOf(marker);
}

/**
 * Check whether a filename is a marker file for the given resource type.
 */
export function isMarkerFile(filename: string, resourceType: ResourceTypeId): boolean {
  const marker = getMarkerFilename(resourceType);
  return marker !== null && filename === marker;
}
