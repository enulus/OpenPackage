import { join } from 'path';
import { Command } from 'commander';

import { CommandResult, type ExecutionContext } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { parseWorkspaceScope } from '../utils/scope-resolution.js';
import { createExecutionContext } from '../core/execution-context.js';
import { classifyInput } from '../core/install/preprocessing/index.js';
import { resolveRemoteList, type RemoteListResult, collectFiles } from '../core/list/remote-list-resolver.js';
import { groupFilesIntoResources, type ListFileMapping, type ListPackageReport } from '../core/list/list-pipeline.js';
import { resolvePackageByName, type PackageSourceType } from '../utils/package-name-resolution.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { exists } from '../utils/fs.js';
import { detectEntityType } from '../utils/entity-detector.js';
import { formatPathForDisplay } from '../utils/formatters.js';
import { logger } from '../utils/logger.js';
import {
  collectScopedData,
  mergeTrackedAndUntrackedResources,
  mergeResourcesAcrossScopes,
  type HeaderInfo,
} from '../core/list/scope-data-collector.js';
import {
  dim,
  sectionHeader,
  printResourcesView,
  printRemotePackageDetail,
  printMetadataSection,
  extractMetadataFromManifest,
  type ViewMetadataEntry,
} from '../core/list/list-printers.js';
import type { EnhancedResourceGroup, ResourceScope } from '../core/list/list-tree-renderer.js';
import { resolveDeclaredPath } from '../utils/path-resolution.js';

interface ViewOptions {
  scope?: string;
  files?: boolean;
  remote?: boolean;
  profile?: string;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Local package directory resolution (fallback when not in workspace index)
// ---------------------------------------------------------------------------

function sourceTypeToScope(sourceType: PackageSourceType): ResourceScope {
  return sourceType === 'global' ? 'global' : 'project';
}

interface LocalPackageResult {
  report: ListPackageReport;
  headerInfo: HeaderInfo;
  scope: ResourceScope;
  metadata: ViewMetadataEntry[];
}

async function resolveLocalPackage(
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
// Remote resolution
// ---------------------------------------------------------------------------

async function resolveRemoteForPackage(
  packageName: string,
  execContext: ExecutionContext,
  options: ViewOptions
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
// Main command
// ---------------------------------------------------------------------------

async function viewCommand(
  packageName: string,
  options: ViewOptions,
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};

  if (options.scope && options.remote) {
    throw new ValidationError('Cannot use --scope with --remote; choose one: --scope for local lookup or --remote for remote-only.');
  }

  // Parse and validate scope when provided
  let viewScope: 'project' | 'global' | undefined;
  if (options.scope) {
    try {
      viewScope = parseWorkspaceScope(options.scope);
    } catch (error) {
      throw error instanceof ValidationError ? error : new ValidationError(error instanceof Error ? error.message : String(error));
    }
  }

  // --- Remote-only mode ---
  if (options.remote) {
    const execContext = await createExecutionContext({
      global: viewScope === 'global',
      cwd: programOpts.cwd
    });
    const remoteResult = await resolveRemoteForPackage(packageName, execContext, options);
    if (remoteResult) {
      printRemotePackageDetail(remoteResult, !!options.files, true);
      return { success: true };
    }
    throw new ValidationError(`Package '${packageName}' not found remotely`);
  }

  // --- Try local first ---
  const showBothScopes = viewScope === undefined;
  const showGlobal = viewScope === 'global' || showBothScopes;
  const showProject = viewScope === 'project' || showBothScopes;

  const results = await collectScopedData(
    packageName,
    {
      showProject,
      showGlobal,
      pipelineOptions: {
        files: options.files,
      },
      cwd: programOpts.cwd
    },
    (opts) => createExecutionContext({ global: opts.global, cwd: opts.cwd })
  );

  // --- Fallback tier 2: local packages directory (not in workspace index) ---
  if (results.length === 0) {
    const searchRegistry = showBothScopes; // only when no scope specified
    const localResult = await resolveLocalPackage(
      packageName,
      programOpts.cwd || process.cwd(),
      { showProject, showGlobal, searchRegistry }
    );

    if (localResult) {
      return printLocalPackageView(localResult, !!options.files);
    }

    // --- Fallback tier 3: remote registry/git ---
    const fallbackContext = await createExecutionContext({
      global: viewScope === 'global',
      cwd: programOpts.cwd
    });
    const remoteResult = await resolveRemoteForPackage(packageName, fallbackContext, options);
    if (remoteResult) {
      printRemotePackageDetail(remoteResult, !!options.files, true);
      return { success: true };
    }
    throw new ValidationError(`Package '${packageName}' not found locally or remotely`);
  }

  // --- Build resource view from workspace index data ---
  const scopedResources: Array<{ scope: ResourceScope; groups: EnhancedResourceGroup[] }> = [];

  for (const { scope, result } of results) {
    const merged = mergeTrackedAndUntrackedResources(result.tree, undefined, scope);
    if (merged.length > 0) {
      scopedResources.push({ scope, groups: merged });
    }
  }

  if (scopedResources.length === 0) {
    console.log(dim(`No resources found for package '${packageName}'.`));
    return { success: true };
  }

  const mergedResources = mergeResourcesAcrossScopes(scopedResources);

  // Build header and metadata from the target package
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
      const execContext = await createExecutionContext({
        global: firstScope === 'global',
        cwd: programOpts.cwd
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
  if (viewMetadata.length === 0) viewMetadata = extractMetadataFromManifest({ name: headerInfo.name, version: headerInfo.version });

  printResourcesView(mergedResources, !!options.files, headerInfo, {
    showScopeBadges: false,
    metadata: viewMetadata
  });

  // Show declared dependencies from the package manifest
  if (targetPkg) {
    printDependenciesList(targetPkg.dependencies ?? []);
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function printDependenciesList(dependencies: string[]): void {
  console.log(sectionHeader('Dependencies', dependencies.length));
  dependencies.forEach((dep, index) => {
    const isLast = index === dependencies.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    console.log(`${connector}${dep}`);
  });
}

function printLocalPackageView(
  localResult: LocalPackageResult,
  showFiles: boolean
): CommandResult {
  const { report, headerInfo, scope, metadata } = localResult;

  if (report.resourceGroups && report.resourceGroups.length > 0) {
    const enhanced: EnhancedResourceGroup[] = report.resourceGroups.map(group => ({
      resourceType: group.resourceType,
      resources: group.resources.map(resource => ({
        name: resource.name,
        resourceType: resource.resourceType,
        files: resource.files.map(f => ({
          ...f,
          status: 'tracked' as const,
          scope
        })),
        status: 'tracked' as const,
        scopes: new Set([scope])
      }))
    }));

    printResourcesView(enhanced, showFiles, headerInfo, {
      showScopeBadges: false,
      pathBaseForDisplay: report.path,
      metadata
    });
  } else {
    console.log(`${headerInfo.name}${headerInfo.version ? `@${headerInfo.version}` : ''} ${dim(`(${headerInfo.path})`)} ${dim(`[${headerInfo.type}]`)}`);
    printMetadataSection(metadata);
    console.log(sectionHeader('Resources', 0));
    console.log(dim('  (no resources)'));
  }

  if (report.dependencies !== undefined) {
    printDependenciesList(report.dependencies);
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Commander setup
// ---------------------------------------------------------------------------

export function setupViewCommand(program: Command): void {
  program
    .command('view')
    .alias('show')
    .description('View package contents, metadata, and dependencies')
    .argument('<package-spec>', 'package name, git URL, or registry spec')
    .option('-s, --scope <scope>', 'workspace scope: project or global (default: search both)')
    .option('-f, --files', 'show individual file paths')
    .option('--remote', 'fetch from remote registry or git, skipping local lookup')
    .option('--profile <profile>', 'profile to use for authentication')
    .option('--api-key <key>', 'API key for authentication (overrides profile)')
    .action(withErrorHandling(async (packageName: string, options: ViewOptions, command: Command) => {
      await viewCommand(packageName, options, command);
    }));
}
