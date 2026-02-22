/**
 * Resource Builder
 *
 * Scans all packages in the workspace index and untracked files to build
 * a flat list of resolved resources for resource-level operations.
 *
 * Also provides a source-side builder that wraps the resource discoverer
 * to build resources from a package source directory.
 */

import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { classifySourceKey } from './source-key-classifier.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import { scanUntrackedFiles } from '../list/untracked-files-scanner.js';
import { normalizeType, RESOURCE_TYPE_ORDER } from './resource-registry.js';
import { deriveUntrackedResourceName } from './resource-naming.js';
import type { ResourceScope } from './scope-traversal.js';

export interface ResolvedResource {
  kind: 'tracked' | 'untracked';
  resourceName: string;
  resourceType: string;
  /** Package name (only for tracked resources) */
  packageName?: string;
  /** Source keys in workspace index that belong to this resource (only for tracked) */
  sourceKeys: Set<string>;
  /** Target file paths in the workspace (for display) */
  targetFiles: string[];
  scope: ResourceScope;
  /** Absolute path to source file/directory (source-side builder only) */
  sourcePath?: string;
  /** Install kind - file or directory (source-side builder only) */
  installKind?: 'file' | 'directory';
}

export interface ResolvedPackage {
  packageName: string;
  version?: string;
  resourceCount: number;
  targetFiles: string[];
  scope: ResourceScope;
}

export interface WorkspaceResources {
  resources: ResolvedResource[];
  packages: ResolvedPackage[];
}

/**
 * Build a flat list of all workspace resources (tracked and untracked)
 * for use in resource-level operations.
 */
export async function buildWorkspaceResources(
  targetDir: string,
  scope: ResourceScope
): Promise<WorkspaceResources> {
  const { index } = await readWorkspaceIndex(targetDir);
  const packages = index.packages || {};

  const resources: ResolvedResource[] = [];
  const resolvedPackages: ResolvedPackage[] = [];

  // Process tracked packages (including workspace package — its installed
  // resources can be uninstalled; manifest removal is skipped for root package)
  for (const [pkgName, pkgEntry] of Object.entries(packages)) {
    const filesMapping = pkgEntry.files || {};
    const resourceMap = new Map<string, { sourceKeys: Set<string>; targetFiles: string[] }>();
    const allTargetFiles: string[] = [];

    for (const [sourceKey, mappings] of Object.entries(filesMapping)) {
      const { resourceType, resourceName } = classifySourceKey(sourceKey);

      const key = resourceType === 'other'
        ? 'other::other'
        : `${resourceType}::${resourceName}`;

      if (!resourceMap.has(key)) {
        resourceMap.set(key, { sourceKeys: new Set(), targetFiles: [] });
      }
      const entry = resourceMap.get(key)!;
      entry.sourceKeys.add(sourceKey);

      for (const mapping of mappings) {
        const target = getTargetPath(mapping);
        entry.targetFiles.push(target);
        allTargetFiles.push(target);
      }
    }

    // Create ResolvedResource entries for this package
    for (const [key, entry] of resourceMap) {
      const [resourceType, resourceName] = key.split('::');
      resources.push({
        kind: 'tracked',
        resourceName,
        resourceType,
        packageName: pkgName,
        sourceKeys: entry.sourceKeys,
        targetFiles: entry.targetFiles,
        scope,
      });
    }

    // Build ResolvedPackage
    resolvedPackages.push({
      packageName: pkgName,
      version: pkgEntry.version,
      resourceCount: resourceMap.size,
      targetFiles: allTargetFiles,
      scope,
    });
  }

  // Process untracked files
  const untrackedResult = await scanUntrackedFiles(targetDir);
  const untrackedMap = new Map<string, string[]>();

  for (const file of untrackedResult.files) {
    const resourceType = normalizeType(file.category);
    const resourceName = deriveUntrackedResourceName(file.workspacePath);
    const key = `${resourceType}::${resourceName}`;

    if (!untrackedMap.has(key)) {
      untrackedMap.set(key, []);
    }
    untrackedMap.get(key)!.push(file.workspacePath);
  }

  for (const [key, targetFiles] of untrackedMap) {
    const [resourceType, resourceName] = key.split('::');
    resources.push({
      kind: 'untracked',
      resourceName,
      resourceType,
      sourceKeys: new Set(),
      targetFiles,
      scope,
    });
  }

  // Sort resources by type order then name
  const typeOrderMap = new Map(RESOURCE_TYPE_ORDER.map((t, i) => [t, i]));
  resources.sort((a, b) => {
    const orderA = typeOrderMap.get(a.resourceType as any) ?? Infinity;
    const orderB = typeOrderMap.get(b.resourceType as any) ?? Infinity;
    if (orderA !== orderB) return orderA - orderB;
    return a.resourceName.localeCompare(b.resourceName);
  });

  // Sort packages by name
  resolvedPackages.sort((a, b) => a.packageName.localeCompare(b.packageName));

  return { resources, packages: resolvedPackages };
}

/**
 * Build a flat list of resources from a package source directory.
 * Wraps the resource discoverer and normalizes output into ResolvedResource[].
 * Used by commands that operate on package sources (add --copy, remove).
 *
 * @param sourceDir - Absolute path to the package source directory
 * @param scope - Resource scope for the source
 */
export async function buildSourceResources(
  sourceDir: string,
  scope: ResourceScope
): Promise<WorkspaceResources> {
  const { discoverResources } = await import('../install/resource-discoverer.js');
  const discovery = await discoverResources(sourceDir, sourceDir);

  const resources: ResolvedResource[] = [];

  for (const discovered of discovery.all) {
    resources.push({
      kind: 'tracked',
      resourceName: discovered.displayName,
      resourceType: discovered.resourceType,
      sourceKeys: new Set([discovered.resourcePath]),
      targetFiles: [discovered.resourcePath],
      scope,
      sourcePath: discovered.filePath,
      installKind: discovered.installKind,
    });
  }

  // Sort by type order then name (same as workspace builder)
  const typeOrderMap = new Map(RESOURCE_TYPE_ORDER.map((t, i) => [t, i]));
  resources.sort((a, b) => {
    const orderA = typeOrderMap.get(a.resourceType as any) ?? Infinity;
    const orderB = typeOrderMap.get(b.resourceType as any) ?? Infinity;
    if (orderA !== orderB) return orderA - orderB;
    return a.resourceName.localeCompare(b.resourceName);
  });

  return { resources, packages: [] };
}
