import type { ResourceTypeId, InstallableResourceTypeId, ResourceTypeDef } from '../../types/resources.js';
export type { ResourceTypeId, InstallableResourceTypeId, ResourceTypeDef };

const DEFINITIONS: readonly ResourceTypeDef[] = [
  { id: 'rule',    dirName: 'rules',    labelPlural: 'Rules',              pluralKey: 'rules',    order: 0, installable: true  },
  { id: 'agent',   dirName: 'agents',   labelPlural: 'Agents',             pluralKey: 'agents',   order: 1, installable: true  },
  { id: 'command', dirName: 'commands', labelPlural: 'Commands',           pluralKey: 'commands', order: 2, installable: true  },
  { id: 'skill',   dirName: 'skills',   labelPlural: 'Skills',             pluralKey: 'skills',   order: 3, installable: true  },
  { id: 'hook',    dirName: 'hooks',    labelPlural: 'Hooks',              pluralKey: 'hooks',    order: 4, installable: true  },
  { id: 'mcp',     dirName: null,       labelPlural: 'MCP Servers',        pluralKey: 'mcps',     order: 5, installable: true  },
  { id: 'other',   dirName: null,       labelPlural: 'Other',              pluralKey: 'other',    order: 6, installable: false },
] as const;

const BY_ID = new Map<ResourceTypeId, ResourceTypeDef>(
  DEFINITIONS.map(d => [d.id, d])
);

const DIR_TO_TYPE_MAP: Record<string, ResourceTypeId> = {};
for (const def of DEFINITIONS) {
  if (def.dirName) {
    DIR_TO_TYPE_MAP[def.dirName] = def.id;
  }
}

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

export const DIR_TO_TYPE: Readonly<Record<string, ResourceTypeId>> = DIR_TO_TYPE_MAP;

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
  return DIR_TO_TYPE_MAP[dirName];
}
