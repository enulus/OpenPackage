/**
 * Workspace Resource Collector
 *
 * Collects and groups workspace resources for interactive uninstall.
 * Pure data collection — no terminal UI dependencies.
 */

import { join } from 'path';
import { buildWorkspaceResources, type ResolvedResource, type ResolvedPackage } from '../resources/resource-builder.js';
import { traverseScopes, type ResourceScope } from '../resources/scope-traversal.js';
import { normalizeType, RESOURCE_TYPE_ORDER, toLabelPlural } from '../resources/resource-registry.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { formatScopeTag } from '../../utils/formatters.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import type { ResolutionCandidate } from '../resources/resource-resolver.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceCollectionResult {
  /** All resolved resources across scopes */
  allResources: ResolvedResource[];
  /** All resolved packages across scopes */
  allPackages: ResolvedPackage[];
  /** Map from scope to target directory */
  scopeToTargetDir: Map<ResourceScope, string>;
}

export interface GroupedUninstallOptions {
  /** Grouped options for prompt display: category -> items */
  groupedOptions: Record<string, Array<{ label: string; value: UninstallChoiceValue }>>;
  /** Total number of selectable items */
  totalItems: number;
}

export type UninstallChoiceValue =
  | { kind: 'resource'; resource: ResolvedResource }
  | { kind: 'package'; packageName: string; scope: ResourceScope; resources: ResolvedResource[] };

export interface BatchUninstallSummary {
  uninstalledCount: number;
  typeCounts: Map<string, number>;
  allRemovedFiles: Array<{ path: string; targetDir: string }>;
}

// ---------------------------------------------------------------------------
// Resource collection
// ---------------------------------------------------------------------------

/**
 * Collect workspace resources across scopes, optionally filtered by package.
 */
export async function collectWorkspaceResources(
  traverseOpts: { programOpts?: Record<string, any>; globalOnly?: boolean; projectOnly?: boolean },
  packageFilter?: string
): Promise<WorkspaceCollectionResult> {
  const scopeToTargetDir = new Map<ResourceScope, string>();

  const scopeResults = await traverseScopes(
    traverseOpts,
    async ({ scope, context }) => {
      scopeToTargetDir.set(scope, context.targetDir);
      return buildWorkspaceResources(context.targetDir, scope);
    }
  );

  let allResources = scopeResults.flatMap(sr => sr.result.resources);
  let allPackages = scopeResults.flatMap(sr => sr.result.packages);

  if (packageFilter) {
    allResources = allResources.filter(r => r.packageName === packageFilter);
    allPackages = allPackages.filter(p => p.packageName === packageFilter);
  }

  return { allResources, allPackages, scopeToTargetDir };
}

// ---------------------------------------------------------------------------
// Group for selection
// ---------------------------------------------------------------------------

/**
 * Build grouped options for the interactive uninstall prompt.
 */
export async function buildGroupedUninstallOptions(
  collection: WorkspaceCollectionResult,
  programOpts: Record<string, any>
): Promise<GroupedUninstallOptions> {
  const { allResources, allPackages, scopeToTargetDir } = collection;
  const groupedOptions: Record<string, Array<{ label: string; value: UninstallChoiceValue }>> = {};

  // Separate tracked resources by package+scope and untracked resources
  const resourcesByPackageAndScope = new Map<string, ResolvedResource[]>();
  const untrackedResources: ResolvedResource[] = [];

  for (const resource of allResources) {
    if (resource.kind === 'tracked' && resource.packageName) {
      const key = `${resource.packageName}::${resource.scope}`;
      if (!resourcesByPackageAndScope.has(key)) {
        resourcesByPackageAndScope.set(key, []);
      }
      resourcesByPackageAndScope.get(key)!.push(resource);
    } else {
      untrackedResources.push(resource);
    }
  }

  // Add empty packages (packages with 0 resources) to the map
  for (const pkg of allPackages) {
    const key = `${pkg.packageName}::${pkg.scope}`;
    if (!resourcesByPackageAndScope.has(key)) {
      resourcesByPackageAndScope.set(key, []);
    }
  }

  // Create sorted package groups
  const packageGroups = Array.from(resourcesByPackageAndScope.entries())
    .sort((a, b) => {
      const [pkgA, scopeA] = a[0].split('::');
      const [pkgB, scopeB] = b[0].split('::');
      const nameCompare = pkgA.localeCompare(pkgB);
      if (nameCompare !== 0) return nameCompare;
      return scopeA === 'project' ? -1 : 1;
    });

  const totalItems = packageGroups.length + untrackedResources.length;

  if (totalItems === 0) {
    return { groupedOptions, totalItems: 0 };
  }

  // Read package manifests for dependency counts
  const packageDependencyCounts = await loadPackageDependencyCounts(
    allPackages, scopeToTargetDir, programOpts
  );

  // Build package options
  const packageOptions: Array<{ label: string; value: UninstallChoiceValue }> = [];

  for (const [key, resources] of packageGroups) {
    const [pkgName, scope] = key.split('::');
    const pkg = allPackages.find(p => p.packageName === pkgName && p.scope === scope);
    const versionSuffix = pkg?.version && pkg.version !== '0.0.0' ? `@${pkg.version}` : '';
    const scopeTag = pkg ? formatScopeTag(pkg.scope) : formatScopeTag(scope);

    const resourceCount = resources.length;
    const depCount = packageDependencyCounts.get(key) || 0;

    let hint: string;
    if (resourceCount === 0) {
      hint = depCount > 0
        ? `No resources, declares ${depCount} ${depCount === 1 ? 'dependency' : 'dependencies'}`
        : 'No resources';
    } else {
      const totalFiles = resources.flatMap(r => r.targetFiles).length;
      hint = `${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}`;
    }

    packageOptions.push({
      value: { kind: 'package', packageName: pkgName, scope: scope as ResourceScope, resources },
      label: `${pkgName}${versionSuffix}${scopeTag} (${hint})`
    });
  }

  if (packageOptions.length > 0) {
    groupedOptions['Packages'] = packageOptions;
  }

  // Untracked resources grouped by type
  const untrackedByType = new Map<string, ResolvedResource[]>();
  for (const resource of untrackedResources) {
    const type = normalizeType(resource.resourceType);
    if (!untrackedByType.has(type)) {
      untrackedByType.set(type, []);
    }
    untrackedByType.get(type)!.push(resource);
  }

  for (const typeId of RESOURCE_TYPE_ORDER) {
    const resources = untrackedByType.get(typeId);
    if (!resources || resources.length === 0) continue;

    const categoryName = toLabelPlural(typeId);
    groupedOptions[categoryName] = resources.map(resource => {
      const scopeTag = formatScopeTag(resource.scope);
      const fileCount = resource.targetFiles.length;
      return {
        value: { kind: 'resource' as const, resource },
        label: `${resource.resourceName}${scopeTag} (${fileCount} ${fileCount === 1 ? 'file' : 'files'})`
      };
    });
  }

  return { groupedOptions, totalItems };
}

// ---------------------------------------------------------------------------
// Batch execution
// ---------------------------------------------------------------------------

/**
 * Execute a batch of uninstall selections.
 * Returns a summary of what was removed.
 */
export async function executeBatchUninstall(
  selected: UninstallChoiceValue[],
  options: { dryRun?: boolean },
  collection: WorkspaceCollectionResult,
  programOpts: Record<string, any>,
  createContext: (opts: { global: boolean; cwd?: string; interactive: boolean }) => Promise<ExecutionContext>,
  executeCandidate: (candidate: ResolutionCandidate, options: any, ctx: ExecutionContext) => Promise<void>
): Promise<BatchUninstallSummary> {
  const { allPackages, scopeToTargetDir } = collection;
  const typeCounts = new Map<string, number>();
  let uninstalledCount = 0;
  const allRemovedFiles: Array<{ path: string; targetDir: string }> = [];

  for (const selection of selected) {
    if (selection.kind === 'package') {
      const { packageName, scope, resources } = selection;
      const targetDir = scopeToTargetDir.get(scope);
      const pkg = allPackages.find(p => p.packageName === packageName && p.scope === scope);
      const execCtx = await createContext({
        global: scope === 'global',
        cwd: programOpts.cwd,
        interactive: true
      });
      const candidate: ResolutionCandidate = {
        kind: 'package',
        package: {
          packageName,
          scope,
          version: pkg?.version,
          resourceCount: resources.length,
          targetFiles: resources.flatMap(r => r.targetFiles)
        }
      };
      if (targetDir) {
        candidate.package!.targetFiles.forEach(f => allRemovedFiles.push({ path: f, targetDir }));
      }
      await executeCandidate(candidate, options, execCtx);
      typeCounts.set('packages', (typeCounts.get('packages') || 0) + 1);
      uninstalledCount++;
    } else {
      const resource = selection.resource;
      const targetDir = scopeToTargetDir.get(resource.scope);
      const candidate: ResolutionCandidate = { kind: 'resource', resource };
      const execCtx = await createContext({
        global: resource.scope === 'global',
        cwd: programOpts.cwd,
        interactive: true
      });
      if (targetDir) {
        resource.targetFiles.forEach(f => allRemovedFiles.push({ path: f, targetDir }));
      }
      await executeCandidate(candidate, options, execCtx);
      const typePlural = toLabelPlural(normalizeType(resource.resourceType)).toLowerCase();
      typeCounts.set(typePlural, (typeCounts.get(typePlural) || 0) + 1);
      uninstalledCount++;
    }
  }

  return { uninstalledCount, typeCounts, allRemovedFiles };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadPackageDependencyCounts(
  packages: ResolvedPackage[],
  scopeToTargetDir: Map<ResourceScope, string>,
  programOpts: Record<string, any>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (const pkg of packages) {
    const key = `${pkg.packageName}::${pkg.scope}`;
    try {
      const targetDir = scopeToTargetDir.get(pkg.scope);
      if (!targetDir) continue;

      const { index } = await readWorkspaceIndex(targetDir);
      const pkgEntry = index.packages[pkg.packageName];
      if (!pkgEntry?.path) continue;

      const packagePath = pkgEntry.path.startsWith('~')
        ? pkgEntry.path.replace('~', programOpts.homeDir || process.env.HOME || process.env.USERPROFILE || '')
        : pkgEntry.path;

      const manifestPath = join(packagePath, 'openpackage.yml');
      const manifest = await parsePackageYml(manifestPath);
      const depCount = (manifest.dependencies || []).length + (manifest['dev-dependencies'] || []).length;
      counts.set(key, depCount);
    } catch {
      counts.set(key, 0);
    }
  }

  return counts;
}
