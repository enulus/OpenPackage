/**
 * View Helpers
 *
 * Data transformation utilities for the view pipeline.
 * Converts raw ListPackageReport data into EnhancedResourceGroup[]
 * for rendering by any UI layer (CLI, GUI, etc.).
 */

import type { ListPackageReport, ListFileMapping } from '../list/list-pipeline.js';
import type { EnhancedResourceGroup, EnhancedResourceInfo, EnhancedFileMapping, ResourceScope } from '../list/list-tree-renderer.js';

/**
 * Transform a ListPackageReport's resource groups into EnhancedResourceGroup[]
 * with scope and status annotations.
 *
 * This is a pure data transformation — no terminal or UI dependencies.
 */
export function enhanceResourceGroups(
  report: ListPackageReport,
  scope: ResourceScope
): EnhancedResourceGroup[] {
  if (!report.resourceGroups) return [];

  return report.resourceGroups.map((group) => ({
    resourceType: group.resourceType,
    resources: group.resources.map((resource) => ({
      name: resource.name,
      resourceType: resource.resourceType,
      files: resource.files.map((file) => ({
        ...file,
        status: 'tracked' as const,
        scope,
      })),
      status: 'tracked' as const,
      scopes: new Set<ResourceScope>([scope]),
    })),
  }));
}
