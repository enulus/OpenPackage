/**
 * Shared resource types extracted from core/resources/resource-registry.ts
 */

export type ResourceTypeId = 'rule' | 'agent' | 'command' | 'skill' | 'hook' | 'mcp' | 'other';

export type InstallableResourceTypeId = Exclude<ResourceTypeId, 'other'>;

export interface ResourceTypeDef {
  id: ResourceTypeId;
  dirName: string | null;
  /** Marker filename that identifies a resource boundary (e.g. 'SKILL.md' for skills) */
  marker: string | null;
  labelPlural: string;
  pluralKey: string;
  order: number;
  installable: boolean;
}
