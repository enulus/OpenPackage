import { resolve } from 'path';
import type { ExecutionContext } from '../../types/index.js';
import { runListPipeline, type ListPackageReport, type ListTreeNode, type ListPipelineResult, type ListFileMapping } from './list-pipeline.js';
import { logger } from '../../utils/logger.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { getLocalPackageYmlPath } from '../../utils/paths.js';
import { getDisplayTargetDir } from '../../core/execution-context.js';
import type { UntrackedScanResult } from './untracked-files-scanner.js';
import { detectEntityType, getEntityDisplayName } from '../../utils/entity-detector.js';
import { formatPathForDisplay } from '../../utils/formatters.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { classifyAndGroupUntrackedFiles } from '../resources/resource-classifier.js';
import { RESOURCE_TYPE_ORDER_PLURAL, normalizeType, toPluralKey } from '../resources/resource-registry.js';
import { isFullInstallScope } from '../../types/workspace-index.js';
import { deriveNamespaceSlug } from '../../utils/plugin-naming.js';
import type { EnhancedFileMapping, EnhancedResourceInfo, EnhancedResourceGroup, ResourceScope } from './list-tree-renderer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileStatus = 'tracked' | 'modified' | 'clean' | 'outdated' | 'diverged' | 'untracked' | 'missing';
type ResourceStatus = 'tracked' | 'modified' | 'clean' | 'outdated' | 'diverged' | 'partial' | 'untracked' | 'missing' | 'mixed';

export interface ScopeResult {
  headerName: string;
  headerVersion: string | undefined;
  headerPath: string;
  headerType: 'workspace' | 'package' | 'resource';
  tree: ListTreeNode[];
  data: ListPipelineResult;
}

export interface HeaderInfo {
  name: string;
  version?: string;
  path: string;
  type: 'workspace' | 'package' | 'resource';
  /** When set, header renders scope badge instead of path + type tag. */
  scope?: ResourceScope;
}

interface ListPipelineOptions {
  files?: boolean;
  all?: boolean;
  status?: boolean;
  platforms?: string[];
  remote?: boolean;
}

// ---------------------------------------------------------------------------
// Scope data collection
// ---------------------------------------------------------------------------

/**
 * Run the list pipeline for a single execution context (one scope).
 * Returns null if no data found for the given package/scope.
 */
async function runScopeList(
  packageName: string | undefined,
  execContext: ExecutionContext,
  options: ListPipelineOptions
): Promise<ScopeResult | null> {
  const skipLocal = options.remote && !!packageName;

  let packages: ListPackageReport[] = [];
  let tree: ListTreeNode[] = [];
  let data: ListPipelineResult | undefined;

  if (!skipLocal) {
    const result = await runListPipeline(packageName, execContext, {
      includeFiles: options.files || !!packageName,
      all: options.all,
      status: options.status,
      platforms: options.platforms
    });

    packages = result.data?.packages ?? [];
    tree = result.data?.tree ?? [];
    data = result.data!;
  }

  const hasUntrackedData = data?.untrackedFiles && data.untrackedFiles.totalFiles > 0;
  // If a specific package was requested but not found, return null to trigger remote fallback
  if (packageName && packages.length === 0) {
    return null;
  }
  // For general listing (no package specified), return null only if there's no data at all
  if (!data || (packages.length === 0 && !hasUntrackedData && !packageName)) {
    return null;
  }

  let headerName = 'Unnamed';
  let headerVersion: string | undefined;
  let headerPath: string;
  let headerType: 'workspace' | 'package' | 'resource';

  // When a specific package is queried, use the actual entity path and type
  if (packageName && data.targetPackage) {
    const targetPkg = data.targetPackage;
    
    // Resolve the actual filesystem path from the package path
    const resolved = resolveDeclaredPath(targetPkg.path, execContext.targetDir);
    const absolutePath = resolved.absolute;
    
    // Detect entity type based on the actual path
    headerType = await detectEntityType(absolutePath);
    
    // Get display name (from openpackage.yml if available, fallback to package name)
    headerName = await getEntityDisplayName(absolutePath, targetPkg.name);
    
    // Get version if available
    headerVersion = targetPkg.version;
    
    // Format the path for display
    headerPath = formatPathForDisplay(absolutePath);
  } else {
    // General workspace listing - use the workspace/targetDir info
    const displayDir = getDisplayTargetDir(execContext);
    headerPath = displayDir;
    
    // Detect entity type for the target directory
    headerType = await detectEntityType(execContext.targetDir);
    
    // Try to read name and version from manifest
    const manifestPath = getLocalPackageYmlPath(execContext.targetDir);
    try {
      const manifest = await parsePackageYml(manifestPath);
      headerName = manifest.name || 'Unnamed';
      headerVersion = manifest.version;
    } catch (error) {
      logger.debug(`Failed to read workspace manifest: ${error}`);
    }
  }

  return { headerName, headerVersion, headerPath, headerType, tree, data };
}

/**
 * Collect scoped data from project and/or global contexts.
 */
export async function collectScopedData(
  packageName: string | undefined,
  options: {
    showProject: boolean;
    showGlobal: boolean;
    pipelineOptions: ListPipelineOptions;
    cwd?: string;
  },
  createContext: (opts: { global: boolean; cwd?: string }) => Promise<ExecutionContext>
): Promise<Array<{ scope: ResourceScope; result: ScopeResult }>> {
  const results: Array<{ scope: ResourceScope; result: ScopeResult }> = [];

  // Resolve contexts up front to detect project === global overlap
  let projectContext: ExecutionContext | undefined;
  let globalContext: ExecutionContext | undefined;

  if (options.showProject) {
    projectContext = await createContext({ global: false, cwd: options.cwd });
  }
  if (options.showGlobal) {
    globalContext = await createContext({ global: true, cwd: options.cwd });
  }

  // Skip project when it resolves to the same target as global (avoids duplicate output)
  const skipProject = !!(projectContext && globalContext &&
    resolve(projectContext.targetDir) === resolve(globalContext.targetDir));

  if (projectContext && !skipProject) {
    try {
      const projectResult = await runScopeList(packageName, projectContext, options.pipelineOptions);
      if (projectResult) {
        results.push({ scope: 'project', result: projectResult });
      }
    } catch (error) {
      logger.debug(`Failed to list project scope${packageName ? ` for package '${packageName}'` : ''}: ${error}`);
    }
  }

  if (globalContext) {
    try {
      const globalResult = await runScopeList(packageName, globalContext, options.pipelineOptions);
      if (globalResult) {
        results.push({ scope: 'global', result: globalResult });
      }
    } catch (error) {
      logger.debug(`Failed to list global scope${packageName ? ` for package '${packageName}'` : ''}: ${error}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Resource merging
// ---------------------------------------------------------------------------

/** Synthetic resource type for package-container entries (not in RESOURCE_TYPE_ORDER_PLURAL). */
const PACKAGES_GROUP_TYPE = 'packages';

function normalizeCategory(category: string): string {
  return toPluralKey(normalizeType(category));
}

function calculateResourceStatus(files: EnhancedFileMapping[]): ResourceStatus {
  if (files.length === 0) return 'untracked';

  const hasTracked = files.some(f => f.status === 'tracked');
  const hasModified = files.some(f => f.status === 'modified');
  const hasOutdated = files.some(f => f.status === 'outdated');
  const hasDiverged = files.some(f => f.status === 'diverged');
  const hasClean = files.some(f => f.status === 'clean');
  const hasUntracked = files.some(f => f.status === 'untracked');
  const hasMissing = files.some(f => f.status === 'missing');

  // Content-status-aware logic — priority: diverged > modified > outdated
  if (hasDiverged) return 'diverged';
  if (hasModified) return 'modified';
  if (hasOutdated) return 'outdated';
  if (hasClean && !hasTracked && !hasUntracked && !hasMissing) return 'clean';
  if (hasClean && hasMissing && !hasUntracked) return 'partial';

  if (hasUntracked && !hasTracked && !hasMissing && !hasClean) return 'untracked';
  if (hasTracked && !hasUntracked && !hasMissing) return 'tracked';
  if (hasTracked && hasMissing && !hasUntracked) return 'partial';
  if (hasMissing && !hasTracked && !hasUntracked && !hasClean) return 'missing';
  return 'mixed';
}

/** Map contentStatus → FileStatus. Missing files are handled separately. */
const CONTENT_STATUS_MAP: Record<string, FileStatus> = {
  modified: 'modified',
  outdated: 'outdated',
  diverged: 'diverged',
  'source-deleted': 'outdated',
  clean: 'clean',
};

/**
 * Enhance files from a ListFileMapping to EnhancedFileMapping with status info.
 */
function enhanceFiles(files: ListFileMapping[], scope: ResourceScope): EnhancedFileMapping[] {
  return files.map(f => ({
    ...f,
    status: !f.exists ? 'missing' : (CONTENT_STATUS_MAP[f.contentStatus ?? ''] ?? 'tracked') as FileStatus,
    scope,
  }));
}

/**
 * Returns true when a tree node should be rendered as a package container
 * (i.e. its resources are nested under a `packages/<namespace>` entry).
 */
function isPackageContainer(
  node: ListTreeNode,
  workspaceRootNames?: Set<string>
): boolean {
  return (
    isFullInstallScope(node.report.installScope) &&
    !node.report.isEmbedded &&
    !workspaceRootNames?.has(node.report.name)
  );
}

/**
 * Collect workspace root names from scope results.
 * These are self-entries representing each scope's root, not real dependency packages.
 */
export function collectWorkspaceRootNames(
  results: Array<{ result: { headerType: string; headerName: string } }>
): Set<string> {
  const names = new Set<string>();
  for (const { result } of results) {
    if (result.headerType === 'workspace' && result.headerName) {
      names.add(result.headerName);
    }
  }
  return names;
}

/**
 * Convert a typeMap into an ordered array of EnhancedResourceGroups.
 * Handles known types (RESOURCE_TYPE_ORDER_PLURAL), the synthetic 'packages'
 * group, and any remaining unknown types.
 */
function buildOrderedGroups(
  typeMap: Map<string, Map<string, EnhancedResourceInfo>>
): EnhancedResourceGroup[] {
  const groups: EnhancedResourceGroup[] = [];

  for (const type of RESOURCE_TYPE_ORDER_PLURAL) {
    const resourcesMap = typeMap.get(type);
    if (resourcesMap && resourcesMap.size > 0) {
      const resources = Array.from(resourcesMap.values())
        .sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ resourceType: type, resources });
    }
  }

  const packagesMap = typeMap.get(PACKAGES_GROUP_TYPE);
  if (packagesMap && packagesMap.size > 0) {
    const resources = Array.from(packagesMap.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ resourceType: PACKAGES_GROUP_TYPE, resources });
  }

  for (const [type, resourcesMap] of typeMap) {
    if (RESOURCE_TYPE_ORDER_PLURAL.includes(type) || type === PACKAGES_GROUP_TYPE) continue;
    const resources = Array.from(resourcesMap.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ resourceType: type, resources });
  }

  return groups;
}

/**
 * Merge tracked resources from tree nodes with untracked file scan results
 * into a unified list of EnhancedResourceGroups.
 */
export function mergeTrackedAndUntrackedResources(
  tree: ListTreeNode[],
  untrackedFiles: UntrackedScanResult | undefined,
  scope: ResourceScope,
  workspaceRootNames?: Set<string>,
  flat?: boolean
): EnhancedResourceGroup[] {
  const typeMap = new Map<string, Map<string, EnhancedResourceInfo>>();

  /**
   * Collect resources from a node into the flat typeMap (non-container path).
   */
  function collectFlatFromNode(node: ListTreeNode): void {
    if (node.report.resourceGroups) {
      for (const group of node.report.resourceGroups) {
        if (!typeMap.has(group.resourceType)) {
          typeMap.set(group.resourceType, new Map());
        }
        const resourcesMap = typeMap.get(group.resourceType)!;

        for (const resource of group.resources) {
          const pkgName = node.report.name;
          if (!resourcesMap.has(resource.name)) {
            const files = enhanceFiles(resource.files, scope);
            resourcesMap.set(resource.name, {
              name: resource.name,
              resourceType: resource.resourceType,
              files,
              status: calculateResourceStatus(files),
              scopes: new Set([scope]),
              packages: new Set([pkgName])
            });
          } else {
            const existing = resourcesMap.get(resource.name)!;
            if (!existing.packages) existing.packages = new Set();
            existing.packages.add(pkgName);
          }
        }
      }
    }
  }

  /**
   * Collect all resources from a node (and its embedded children) as
   * EnhancedResourceInfo children for a package container.
   */
  function collectChildResources(node: ListTreeNode, out: EnhancedResourceInfo[] = []): EnhancedResourceInfo[] {
    if (node.report.resourceGroups) {
      for (const group of node.report.resourceGroups) {
        for (const resource of group.resources) {
          const files = enhanceFiles(resource.files, scope);
          out.push({
            name: resource.name,
            resourceType: resource.resourceType,
            files,
            status: calculateResourceStatus(files),
            scopes: new Set([scope]),
            packages: new Set([node.report.name])
          });
        }
      }
    }

    // Fold embedded children's resources into this container
    for (const child of node.children) {
      if (child.report.isEmbedded) {
        collectChildResources(child, out);
      }
    }

    return out;
  }

  /**
   * Build an EnhancedResourceInfo container from a package container node.
   */
  function buildContainer(node: ListTreeNode, children: EnhancedResourceInfo[], isMissing: boolean): EnhancedResourceInfo {
    const resources = children.filter(c => !c.isDependencyRef);
    const depRefs = children.filter(c => c.isDependencyRef);
    resources.sort((a, b) => a.name.localeCompare(b.name));
    depRefs.sort((a, b) => a.name.localeCompare(b.name));
    const sorted = [...resources, ...depRefs];
    const namespace = node.report.namespace ?? deriveNamespaceSlug(node.report.name);
    const containerName = `${PACKAGES_GROUP_TYPE}/${namespace}`;
    const version = node.report.version && node.report.version !== '0.0.0'
      ? node.report.version : undefined;
    return {
      name: containerName,
      resourceType: PACKAGES_GROUP_TYPE,
      files: [],
      children: sorted,
      status: isMissing ? 'missing' : 'tracked',
      scopes: new Set([scope]),
      packages: new Set([node.report.name]),
      version,
    };
  }

  /**
   * Add a container to the typeMap's packages group.
   */
  function addContainerToTypeMap(container: EnhancedResourceInfo): void {
    if (!typeMap.has(PACKAGES_GROUP_TYPE)) {
      typeMap.set(PACKAGES_GROUP_TYPE, new Map());
    }
    typeMap.get(PACKAGES_GROUP_TYPE)!.set(container.name, container);
  }

  /**
   * Flat mode: process a single node, placing containers at root level in typeMap.
   */
  function visitNodeFlat(node: ListTreeNode): void {
    if (isPackageContainer(node, workspaceRootNames)) {
      const ownResources = collectChildResources(node);
      const isMissing = node.report.state === 'missing';

      // Add dependency references instead of recursing into dep subtrees
      const depRefs = buildDependencyRefs(node);
      const allChildren = [...ownResources, ...depRefs];

      if (allChildren.length > 0 || isMissing) {
        addContainerToTypeMap(buildContainer(node, allChildren, isMissing));
      }
    } else {
      collectFlatFromNode(node);
      for (const child of node.children) {
        visitNodeFlat(child);
      }
    }
  }

  function buildDependencyRefs(node: ListTreeNode): EnhancedResourceInfo[] {
    const nonEmbeddedDeps = node.children.filter(c => !c.report.isEmbedded);
    if (nonEmbeddedDeps.length === 0) return [];
    return nonEmbeddedDeps.map(child => ({
      name: child.report.name,
      resourceType: PACKAGES_GROUP_TYPE,
      files: [] as EnhancedFileMapping[],
      status: child.report.state === 'missing' ? 'missing' as const : 'tracked' as const,
      scopes: new Set([scope]),
      isDependencyRef: true,
    }));
  }

  /**
   * Tree mode: process nodes, collecting containers for the parent to nest.
   * Dependencies are shown as flat reference entries, not expanded subtrees.
   */
  function processNodes(nodes: ListTreeNode[], seen?: Set<string>): EnhancedResourceInfo[] {
    const containers: EnhancedResourceInfo[] = [];
    const visited = seen ?? new Set<string>();

    for (const node of nodes) {
      if (isPackageContainer(node, workspaceRootNames)) {
        // Skip if already processed (diamond dependencies)
        if (visited.has(node.report.name)) continue;
        visited.add(node.report.name);

        // Collect own resources + embedded children's resources
        const ownResources = collectChildResources(node);
        const isMissing = node.report.state === 'missing';
        const nonEmbeddedDeps = node.children.filter(c => !c.report.isEmbedded);

        // Dependencies shown as ↳ reference lines under this container.
        const depRefs = nonEmbeddedDeps.map(child => ({
          name: child.report.name,
          resourceType: PACKAGES_GROUP_TYPE,
          files: [] as EnhancedFileMapping[],
          status: child.report.state === 'missing' ? 'missing' as const : 'tracked' as const,
          scopes: new Set([scope]),
          isDependencyRef: true,
        }));
        const allChildren = [...ownResources, ...depRefs];

        if (allChildren.length > 0 || isMissing) {
          containers.push(buildContainer(node, allChildren, isMissing));
        }

        // Recurse so dependency packages also appear as their own top-level
        // containers. Embedded children are already folded via collectChildResources.
        const nested = processNodes(nonEmbeddedDeps, visited);
        for (const c of nested) containers.push(c);
      } else {
        // Non-container: collect resources flat into typeMap, recurse children
        collectFlatFromNode(node);
        const nested = processNodes(node.children);
        for (const c of nested) containers.push(c);
      }
    }

    return containers;
  }

  if (flat) {
    for (const node of tree) visitNodeFlat(node);
  } else {
    // Tree mode: top-level containers go into typeMap
    const topContainers = processNodes(tree);
    for (const container of topContainers) {
      addContainerToTypeMap(container);
    }
  }

  if (untrackedFiles && untrackedFiles.files.length > 0) {
    const grouped = classifyAndGroupUntrackedFiles(untrackedFiles.files);

    for (const [, group] of grouped) {
      const normalizedType = normalizeCategory(group.resourceType);

      if (!typeMap.has(normalizedType)) {
        typeMap.set(normalizedType, new Map());
      }
      const resourcesMap = typeMap.get(normalizedType)!;

      const untrackedEnhanced: EnhancedFileMapping[] = group.filePaths.map(fp => ({
        source: fp,
        target: fp,
        exists: true,
        status: 'untracked' as FileStatus,
        scope
      }));

      if (!resourcesMap.has(group.fullName)) {
        resourcesMap.set(group.fullName, {
          name: group.fullName,
          resourceType: normalizedType,
          files: untrackedEnhanced,
          status: 'untracked',
          scopes: new Set([scope])
        });
      } else {
        const existing = resourcesMap.get(group.fullName)!;
        existing.files.push(...untrackedEnhanced);
        existing.status = calculateResourceStatus(existing.files);
      }
    }
  }

  // Recompute status for flat resources that may have been merged with untracked files.
  // Skip package containers — their status is 'tracked' (children carry their own status).
  for (const [type, resourcesMap] of typeMap) {
    if (type === PACKAGES_GROUP_TYPE) continue;
    for (const resource of resourcesMap.values()) {
      resource.status = calculateResourceStatus(resource.files);
    }
  }

  return buildOrderedGroups(typeMap);
}

/**
 * Merge resources from multiple scopes, keeping resources from different scopes
 * as separate entries even when they share the same name.
 * Resources within the same scope are still deduplicated by name.
 */
export function mergeResourcesAcrossScopes(
  scopedResources: Array<{ scope: ResourceScope; groups: EnhancedResourceGroup[] }>
): EnhancedResourceGroup[] {
  const typeMap = new Map<string, Map<string, EnhancedResourceInfo>>();

  for (const { scope, groups } of scopedResources) {
    for (const group of groups) {
      if (!typeMap.has(group.resourceType)) {
        typeMap.set(group.resourceType, new Map());
      }
      const resourcesMap = typeMap.get(group.resourceType)!;

      for (const resource of group.resources) {
        // Key by scope + name so same-named resources in different scopes stay separate
        const key = `${scope}:${resource.name}`;
        if (!resourcesMap.has(key)) {
          resourcesMap.set(key, {
            ...resource,
            scopes: new Set([scope]),
            files: [...resource.files],
            packages: resource.packages ? new Set(resource.packages) : undefined,
            children: resource.children ? [...resource.children] : undefined,
          });
        } else {
          const existing = resourcesMap.get(key)!;
          existing.files.push(...resource.files);
          existing.status = calculateResourceStatus(existing.files);
          if (resource.packages) {
            existing.packages = existing.packages ?? new Set();
            for (const pkg of resource.packages) {
              existing.packages.add(pkg);
            }
          }
        }
      }
    }
  }

  return buildOrderedGroups(typeMap);
}

/**
 * Resolve header info for the workspace listing view.
 */
export async function resolveWorkspaceHeader(
  execContext: ExecutionContext
): Promise<HeaderInfo> {
  const workspacePath = getDisplayTargetDir(execContext);
  const manifestPath = getLocalPackageYmlPath(execContext.targetDir);
  let name = 'Unnamed';
  let version: string | undefined;
  try {
    const manifest = await parsePackageYml(manifestPath);
    name = manifest.name || 'Unnamed';
    version = manifest.version;
  } catch {
    /* ignore */
  }
  const headerType = await detectEntityType(execContext.targetDir);
  return { name, version, path: workspacePath, type: headerType };
}
