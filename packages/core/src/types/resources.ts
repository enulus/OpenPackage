/**
 * Shared resource types extracted from core/resources/resource-registry.ts
 */

export type ResourceTypeId = 'rule' | 'agent' | 'command' | 'skill' | 'hook' | 'mcp' | 'other';

export type InstallableResourceTypeId = Exclude<ResourceTypeId, 'other'>;

export interface ResourceTypeDef {
  id: ResourceTypeId;
  dirName: string | null;
  labelPlural: string;
  pluralKey: string;
  order: number;
  installable: boolean;
}
