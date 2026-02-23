/**
 * View Pipeline
 *
 * Core logic for resolving and viewing package details.
 * No terminal-UI dependencies — display is handled by the CLI command layer.
 */

import { join } from 'path';
import { resolvePackageByName, type PackageSourceType } from '../package-name-resolution.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { detectEntityType } from '../../utils/entity-detector.js';
import { formatPathForDisplay } from '../../utils/formatters.js';
import { logger } from '../../utils/logger.js';
import { collectFiles } from '../list/remote-list-resolver.js';
import { groupFilesIntoResources, type ListFileMapping, type ListPackageReport } from '../list/list-pipeline.js';
import { extractMetadataFromManifest, type ViewMetadataEntry } from '../list/list-printers.js';
import {
  collectScopedData,
  mergeTrackedAndUntrackedResources,
  mergeResourcesAcrossScopes,
  type HeaderInfo,
} from '../list/scope-data-collector.js';
import type { EnhancedResourceGroup, ResourceScope } from '../list/list-tree-renderer.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { classifyInput } from '../install/preprocessing/index.js';
import { resolveRemoteList, type RemoteListResult } from '../list/remote-list-resolver.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath } from '../../utils/paths.js';
import { arePackageNamesEquivalent } from '../../utils/package-name.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalPackageResult {
  report: ListPackageReport;
  headerInfo: HeaderInfo;
  scope: ResourceScope;
  metadata: ViewMetadataEntry[];
}

export interface ViewResult {
  kind: 'workspace-index' | 'local-package' | 'remote' | 'not-found';
}

export interface WorkspaceIndexViewResult extends ViewResult {
  kind: 'workspace-index';
  resources: EnhancedResourceGroup[];
  headerInfo: HeaderInfo;
  metadata: ViewMetadataEntry[];
  dependencies: string[];
}

export interface LocalPackageViewResult extends ViewResult {
  kind: 'local-package';
  localResult: LocalPackageResult;
}

export interface RemoteViewResult extends ViewResult {
  kind: 'remote';
  remoteResult: RemoteListResult;
}

export interface NotFoundViewResult extends ViewResult {
  kind: 'not-found';
}

export type ResolvedViewResult =
  | WorkspaceIndexViewResult
  | LocalPackageViewResult
  | RemoteViewResult
  | NotFoundViewResult;

export interface ViewPipelineOptions {
  scope?: 'project' | 'global';
  files?: boolean;
  remote?: boolean;
  profile?: string;
  apiKey?: string;
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceTypeToScope(sourceType: PackageSourceType): ResourceScope {
  return sourceType === 'global' ? 'global' : 'project';
}

// ---------------------------------------------------------------------------
// Pipeline: resolve local package (tier 2)
// ---------------------------------------------------------------------------

/**
 * Resolve a package by name from local sources (workspace, global, registry).
 * Returns a LocalPackageResult with all data needed for display, or null if not found.
 */
export async function resolveLocalPackage(
  packageName: string,
  cwd: string,
  options: { showProject: boolean; showGlobal: boolean; searchRegistry: boolean }
): Promise<LocalPackageResult | null> {
  const resolution = await resolvePackageByName({
    cwd,
    packageName,
    checkCwd: false,
    searchWorkspace: options.showProject,
    searchGlobal: options.showGlobal,
    searchRegistry: options.searchRegistry
  });

  if (!resolution.found || !resolution.path) {
    return null;
  }

  const packageDir = resolution.path;
  let name = packageName;
  let version = resolution.version;
  let dependencies: string[] | undefined;
  let metadata: ViewMetadataEntry[] = [];

  const manifestPath = join(packageDir, 'openpackage.yml');
  if (await exists(manifestPath)) {
    try {
      const manifest = await parsePackageYml(manifestPath);
      name = manifest.name || packageName;
      version = manifest.version || version;
      metadata = extractMetadataFromManifest(manifest);
      const allDeps = [
        ...(manifest.dependencies || []),
        ...(manifest['dev-dependencies'] || [])
      ];
      dependencies = allDeps.map(dep => dep.name);
    } catch (error) {
      logger.debug(`Failed to parse manifest at ${manifestPath}: ${error}`);
    }
  }
  if (metadata.length === 0) metadata = extractMetadataFromManifest({ name, version });

  const files = await collectFiles(packageDir, packageDir);
  const fileList: ListFileMapping[] = files.map(f => ({
    source: f,
    target: join(packageDir, f),
    exists: true
  }));
  const resourceGroups = fileList.length > 0 ? groupFilesIntoResources(fileList) : undefined;

  const headerType = await detectEntityType(packageDir);
  const scope = sourceTypeToScope(resolution.sourceType!);

  return {
    report: {
      name,
      version,
      path: packageDir,
      state: 'synced',
      totalFiles: fileList.length,
      existingFiles: fileList.length,
      fileList,
      resourceGroups,
      dependencies
    },
    headerInfo: {
      name,
      version: version !== '0.0.0' ? version : undefined,
      path: formatPathForDisplay(packageDir),
      type: headerType
    },
    scope,
    metadata
  };
}

// ---------------------------------------------------------------------------
// Pipeline: resolve workspace root package
// ---------------------------------------------------------------------------

/**
 * Check if the requested package name matches the workspace root package
 * (.openpackage/openpackage.yml) and resolve it directly if so.
 *
 * This handles the case where `opkg view` is run from a workspace directory
 * and the auto-detected (or explicitly provided) name is the workspace itself,
 * not an installed dependency.
 */
async function resolveWorkspaceRootPackage(
  packageName: string,
  cwd: string
): Promise<LocalPackageResult | null> {
  const manifestPath = getLocalPackageYmlPath(cwd);

  if (!(await exists(manifestPath))) {
    return null;
  }

  let manifest;
  try {
    manifest = await parsePackageYml(manifestPath);
  } catch {
    return null;
  }

  const workspaceName = manifest.name;
  if (!workspaceName || !arePackageNamesEquivalent(workspaceName, packageName)) {
    return null;
  }

  const openpackageDir = getLocalOpenPackageDir(cwd);
  const version = manifest.version;
  const metadata = extractMetadataFromManifest(manifest);

  const allDeps = [
    ...(manifest.dependencies || []),
    ...(manifest['dev-dependencies'] || [])
  ];
  const dependencies = allDeps.map(dep => dep.name);

  const files = await collectFiles(openpackageDir, openpackageDir);
  const fileList: ListFileMapping[] = files.map(f => ({
    source: f,
    target: join(openpackageDir, f),
    exists: true
  }));
  const resourceGroups = fileList.length > 0 ? groupFilesIntoResources(fileList) : undefined;

  const headerType = await detectEntityType(openpackageDir);

  return {
    report: {
      name: workspaceName,
      version,
      path: openpackageDir,
      state: 'synced',
      totalFiles: fileList.length,
      existingFiles: fileList.length,
      fileList,
      resourceGroups,
      dependencies
    },
    headerInfo: {
      name: workspaceName,
      version: version !== '0.0.0' ? version : undefined,
      path: formatPathForDisplay(openpackageDir),
      type: headerType
    },
    scope: 'project',
    metadata
  };
}

// ---------------------------------------------------------------------------
// Pipeline: resolve remote package (tier 3)
// ---------------------------------------------------------------------------

/**
 * Attempt remote resolution for a package name.
 */
export async function resolveRemoteForPackage(
  packageName: string,
  execContext: ExecutionContext,
  options: { profile?: string; apiKey?: string }
): Promise<RemoteListResult | null> {
  try {
    const classification = await classifyInput(packageName, {}, execContext);
    if (classification.type === 'bulk' || classification.type === 'path') {
      return null;
    }
    return await resolveRemoteList(classification, execContext, {
      profile: options.profile,
      apiKey: options.apiKey
    });
  } catch (error) {
    logger.debug(`Remote resolution failed for '${packageName}': ${error}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline: full multi-tier resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a package through the multi-tier fallback chain:
 *   Tier 1: Workspace index lookup
 *   Tier 2: Local packages directory (not in workspace index)
 *   Tier 3: Remote registry/git
 *
 * Returns a typed result that the CLI or GUI can render appropriately.
 */
export async function resolvePackageView(
  packageName: string,
  options: ViewPipelineOptions,
  createContext: (opts: { global: boolean; cwd?: string }) => Promise<ExecutionContext>
): Promise<ResolvedViewResult> {
  const showBothScopes = options.scope === undefined;
  const showGlobal = options.scope === 'global' || showBothScopes;
  const showProject = options.scope === 'project' || showBothScopes;

  // --- Remote-only mode ---
  if (options.remote) {
    const execContext = await createContext({
      global: options.scope === 'global',
      cwd: options.cwd
    });
    const remoteResult = await resolveRemoteForPackage(packageName, execContext, options);
    if (remoteResult) {
      return { kind: 'remote', remoteResult };
    }
    return { kind: 'not-found' };
  }

  // --- Tier 1: Workspace index lookup ---
  const results = await collectScopedData(
    packageName,
    {
      showProject,
      showGlobal,
      pipelineOptions: { files: options.files },
      cwd: options.cwd
    },
    (opts) => createContext({ global: opts.global, cwd: opts.cwd })
  );

  if (results.length > 0) {
    const scopedResources: Array<{ scope: ResourceScope; groups: EnhancedResourceGroup[] }> = [];

    for (const { scope, result } of results) {
      const merged = mergeTrackedAndUntrackedResources(result.tree, undefined, scope);
      if (merged.length > 0) {
        scopedResources.push({ scope, groups: merged });
      }
    }

    if (scopedResources.length > 0) {
      const mergedResources = mergeResourcesAcrossScopes(scopedResources);
      const firstResult = results[0].result;
      const firstScope = results[0].scope;
      const targetPkg = firstResult.data.targetPackage;

      const headerInfo = targetPkg
        ? {
            name: targetPkg.name,
            version: targetPkg.version !== '0.0.0' ? targetPkg.version : undefined,
            path: firstResult.headerPath,
            type: firstResult.headerType
          }
        : {
            name: packageName,
            version: undefined,
            path: firstResult.headerPath,
            type: firstResult.headerType
          };

      // Read manifest for metadata
      let viewMetadata: ViewMetadataEntry[] = [];
      if (targetPkg) {
        try {
          const execContext = await createContext({
            global: firstScope === 'global',
            cwd: options.cwd
          });
          const resolved = resolveDeclaredPath(targetPkg.path, execContext.targetDir);
          const manifestPath = join(resolved.absolute, 'openpackage.yml');
          if (await exists(manifestPath)) {
            const manifest = await parsePackageYml(manifestPath);
            viewMetadata = extractMetadataFromManifest(manifest);
          }
        } catch (e) {
          logger.debug(`Failed to read manifest for metadata: ${e}`);
        }
      }
      if (viewMetadata.length === 0) {
        viewMetadata = extractMetadataFromManifest({ name: headerInfo.name, version: headerInfo.version });
      }

      return {
        kind: 'workspace-index',
        resources: mergedResources,
        headerInfo,
        metadata: viewMetadata,
        dependencies: targetPkg?.dependencies ?? []
      };
    }
  }

  // --- Tier 1.5: Workspace root package ---
  // If the package name matches the workspace root (.openpackage/openpackage.yml),
  // resolve it directly. This handles `opkg view` from a workspace where the
  // auto-detected name is the workspace itself, not an installed dependency.
  if (showProject) {
    const cwd = options.cwd || process.cwd();
    const workspaceRootResult = await resolveWorkspaceRootPackage(packageName, cwd);
    if (workspaceRootResult) {
      return { kind: 'local-package', localResult: workspaceRootResult };
    }
  }

  // --- Tier 2: Local packages directory ---
  const searchRegistry = showBothScopes;
  const localResult = await resolveLocalPackage(
    packageName,
    options.cwd || process.cwd(),
    { showProject, showGlobal, searchRegistry }
  );

  if (localResult) {
    return { kind: 'local-package', localResult };
  }

  // --- Tier 3: Remote registry/git ---
  const fallbackContext = await createContext({
    global: options.scope === 'global',
    cwd: options.cwd
  });
  const remoteResult = await resolveRemoteForPackage(packageName, fallbackContext, options);
  if (remoteResult) {
    return { kind: 'remote', remoteResult };
  }

  return { kind: 'not-found' };
}
