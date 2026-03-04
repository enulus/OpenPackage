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

/**
 * Merge tracked resources from tree nodes with untracked file scan results
 * into a unified list of EnhancedResourceGroups.
 */
export function mergeTrackedAndUntrackedResources(
  tree: ListTreeNode[],
  untrackedFiles: UntrackedScanResult | undefined,
  scope: ResourceScope
): EnhancedResourceGroup[] {
  const typeMap = new Map<string, Map<string, EnhancedResourceInfo>>();

  function collectFromNode(node: ListTreeNode): void {
    if (node.report.resourceGroups) {
      for (const group of node.report.resourceGroups) {
        if (!typeMap.has(group.resourceType)) {
          typeMap.set(group.resourceType, new Map());
        }
        const resourcesMap = typeMap.get(group.resourceType)!;

        for (const resource of group.resources) {
          const pkgName = node.report.name;
          if (!resourcesMap.has(resource.name)) {
            const enhancedFiles: EnhancedFileMapping[] = resource.files.map(f => {
              let fileStatus: FileStatus;
              if (!f.exists) {
                fileStatus = 'missing';
              } else if (f.contentStatus === 'modified') {
                fileStatus = 'modified';
              } else if (f.contentStatus === 'outdated') {
                fileStatus = 'outdated';
              } else if (f.contentStatus === 'diverged') {
                fileStatus = 'diverged';
              } else if (f.contentStatus === 'clean') {
                fileStatus = 'clean';
              } else {
                fileStatus = 'tracked';
              }
              return { ...f, status: fileStatus, scope };
            });

            resourcesMap.set(resource.name, {
              name: resource.name,
              resourceType: resource.resourceType,
              files: enhancedFiles,
              status: 'tracked',
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
    node.children.forEach(collectFromNode);
  }

  tree.forEach(collectFromNode);

  if (untrackedFiles && untrackedFiles.files.length > 0) {
    const grouped = classifyAndGroupUntrackedFiles(untrackedFiles.files);

    for (const [, group] of grouped) {
      const normalizedType = normalizeCategory(group.resourceType);

      if (!typeMap.has(normalizedType)) {
        typeMap.set(normalizedType, new Map());
      }
      const resourcesMap = typeMap.get(normalizedType)!;

      const enhancedFiles: EnhancedFileMapping[] = group.filePaths.map(fp => ({
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
          files: enhancedFiles,
          status: 'untracked',
          scopes: new Set([scope])
        });
      } else {
        resourcesMap.get(group.fullName)!.files.push(...enhancedFiles);
      }
    }
  }

  for (const resourcesMap of typeMap.values()) {
    for (const resource of resourcesMap.values()) {
      resource.status = calculateResourceStatus(resource.files);
    }
  }

  const groups: EnhancedResourceGroup[] = [];

  for (const type of RESOURCE_TYPE_ORDER_PLURAL) {
    const resourcesMap = typeMap.get(type);
    if (resourcesMap && resourcesMap.size > 0) {
      const resources = Array.from(resourcesMap.values())
        .sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ resourceType: type, resources });
    }
  }

  for (const [type, resourcesMap] of typeMap) {
    if (RESOURCE_TYPE_ORDER_PLURAL.includes(type)) continue;
    const resources = Array.from(resourcesMap.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ resourceType: type, resources });
  }

  return groups;
}

/**
 * Merge resources from multiple scopes, deduplicating by resource name.
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
        if (!resourcesMap.has(resource.name)) {
          resourcesMap.set(resource.name, {
            ...resource,
            scopes: new Set([scope]),
            files: [...resource.files],
            packages: resource.packages ? new Set(resource.packages) : undefined
          });
        } else {
          const existing = resourcesMap.get(resource.name)!;
          existing.scopes.add(scope);
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

  const groups: EnhancedResourceGroup[] = [];

  for (const type of RESOURCE_TYPE_ORDER_PLURAL) {
    const resourcesMap = typeMap.get(type);
    if (resourcesMap && resourcesMap.size > 0) {
      const resources = Array.from(resourcesMap.values())
        .sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ resourceType: type, resources });
    }
  }

  for (const [type, resourcesMap] of typeMap) {
    if (RESOURCE_TYPE_ORDER_PLURAL.includes(type)) continue;
    const resources = Array.from(resourcesMap.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ resourceType: type, resources });
  }

  return groups;
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
