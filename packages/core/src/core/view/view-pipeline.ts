/**
 * View Pipeline
 *
 * Core logic for resolving and viewing package details.
 * Resolves package contents (metadata, resources, dependencies) — not workspace
 * install state. Display is handled by the CLI command layer.
 */

import { join } from 'path';
import { resolvePackageByName, type PackageSourceType } from '../package-name-resolution.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { detectEntityType } from '../../utils/entity-detector.js';
import { formatPathForDisplay } from '../../utils/formatters.js';
import { logger } from '../../utils/logger.js';
import { collectFiles } from '../list/remote-list-resolver.js';
import { groupFilesIntoResources, appendMarketplacePluginGroup, type ListFileMapping, type ListPackageReport } from '../list/list-pipeline.js';
import { extractMetadataFromManifest, type ViewMetadataEntry } from '../list/list-printers.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { classifyInput } from '../install/preprocessing/index.js';
import { resolveRemoteList, type RemoteListResult } from '../list/remote-list-resolver.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath } from '../../utils/paths.js';
import { arePackageNamesEquivalent } from '../../utils/package-name.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import type { HeaderInfo } from '../list/scope-data-collector.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalPackageResult {
  report: ListPackageReport;
  headerInfo: HeaderInfo;
  metadata: ViewMetadataEntry[];
}

export interface ViewResult {
  kind: 'local-package' | 'remote' | 'not-found';
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

/**
 * Build a LocalPackageResult from a resolved package directory.
 * Shared by Tier 1 (workspace index) and Tier 2 (resolvePackageByName).
 */
async function buildLocalPackageResult(
  packageName: string,
  packageDir: string,
  version?: string,
): Promise<LocalPackageResult> {
  let name = packageName;
  let resolvedVersion = version;
  let dependencies: string[] | undefined;
  let metadata: ViewMetadataEntry[] = [];

  const manifestPath = join(packageDir, 'openpackage.yml');
  if (await exists(manifestPath)) {
    try {
      const manifest = await parsePackageYml(manifestPath);
      name = manifest.name || packageName;
      resolvedVersion = manifest.version || resolvedVersion;
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
  if (metadata.length === 0) metadata = extractMetadataFromManifest({ name, version: resolvedVersion });

  const files = await collectFiles(packageDir, packageDir);
  const fileList: ListFileMapping[] = files.map(f => ({
    source: f,
    target: join(packageDir, f),
    exists: true
  }));
  let resourceGroups = fileList.length > 0 ? groupFilesIntoResources(fileList) : undefined;
  resourceGroups = await appendMarketplacePluginGroup(resourceGroups, packageDir);

  const headerType = await detectEntityType(packageDir);

  return {
    report: {
      name,
      version: resolvedVersion,
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
      version: resolvedVersion !== '0.0.0' ? resolvedVersion : undefined,
      path: formatPathForDisplay(packageDir),
      type: headerType
    },
    metadata
  };
}

// ---------------------------------------------------------------------------
// Pipeline: resolve from workspace index (tier 1)
// ---------------------------------------------------------------------------

/**
 * Look up the package in the workspace index to locate its source directory,
 * then scan its contents. This answers "what does this package contain?"
 * rather than "what is installed from it?".
 */
async function resolveFromWorkspaceIndex(
  packageName: string,
  targetDir: string,
): Promise<LocalPackageResult | null> {
  const { index } = await readWorkspaceIndex(targetDir);
  const packages = index.packages || {};

  // Find the package in the workspace index (exact or equivalent name match)
  let entryKey: string | undefined;
  if (packages[packageName]) {
    entryKey = packageName;
  } else {
    for (const key of Object.keys(packages)) {
      if (arePackageNamesEquivalent(key, packageName)) {
        entryKey = key;
        break;
      }
    }
  }

  if (!entryKey) return null;

  const entry = packages[entryKey];
  const resolved = resolveDeclaredPath(entry.path, targetDir);
  const packageDir = resolved.absolute;

  if (!(await exists(packageDir))) {
    logger.debug(`Workspace index points to '${packageDir}' but it does not exist`);
    return null;
  }

  return buildLocalPackageResult(packageName, packageDir, entry.version);
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

  return buildLocalPackageResult(packageName, resolution.path, resolution.version);
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
  return buildLocalPackageResult(workspaceName, openpackageDir, manifest.version);
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
 *   Tier 1: Workspace index lookup → scan package source directory
 *   Tier 1.5: Workspace root package
 *   Tier 2: Local packages directory (via resolvePackageByName)
 *   Tier 3: Remote registry/git
 *
 * All tiers resolve the package's own contents (metadata, resources, deps),
 * not the workspace install state.
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
  // Look up the package in the workspace index to find its source path,
  // then scan its contents directly (not the workspace install state).
  if (showProject) {
    const cwd = options.cwd || process.cwd();
    const projectContext = await createContext({ global: false, cwd: options.cwd });
    const projectResult = await resolveFromWorkspaceIndex(packageName, projectContext.targetDir);
    if (projectResult) {
      return { kind: 'local-package', localResult: projectResult };
    }
  }

  if (showGlobal) {
    const globalContext = await createContext({ global: true, cwd: options.cwd });
    const globalResult = await resolveFromWorkspaceIndex(packageName, globalContext.targetDir);
    if (globalResult) {
      return { kind: 'local-package', localResult: globalResult };
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
