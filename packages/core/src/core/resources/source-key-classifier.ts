import { DIR_TO_TYPE, type ResourceTypeId } from './resource-registry.js';

export function classifySourceKey(sourceKey: string): { resourceType: ResourceTypeId; resourceName: string } {
  const normalized = sourceKey.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');

  if (parts.length === 1 && (sourceKey === 'mcp.json' || sourceKey === 'mcp.jsonc')) {
    return { resourceType: 'mcp', resourceName: 'configs' };
  }

  const firstDir = parts[0];
  const singularType = DIR_TO_TYPE[firstDir];

  if (!singularType) {
    const name = parts[parts.length - 1].replace(/\.[^.]+$/, '') || sourceKey;
    return { resourceType: 'other', resourceName: name };
  }

  if (singularType === 'skill') {
    const skillName = parts.length > 1 ? parts[1] : 'unnamed';
    return { resourceType: 'skill', resourceName: skillName };
  }

  const fileName = parts[parts.length - 1];
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '') || fileName;
  return { resourceType: singularType, resourceName: nameWithoutExt };
}
