import { Command } from 'commander';

import { CommandResult, type ExecutionContext } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { runListPipeline, type ListPackageReport, type ListTreeNode, type ListPipelineResult, type ListResourceGroup, type ListResourceInfo, type ListFileMapping } from '../core/list/list-pipeline.js';
import { logger } from '../utils/logger.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { getLocalPackageYmlPath } from '../utils/paths.js';
import { createExecutionContext, getDisplayTargetDir } from '../core/execution-context.js';
import type { UntrackedScanResult, UntrackedFile } from '../core/list/untracked-files-scanner.js';
import { classifyInput } from '../core/install/preprocessing/index.js';
import { resolveRemoteList, type RemoteListResult } from '../core/list/remote-list-resolver.js';
import { detectEntityType, getEntityDisplayName } from '../utils/entity-detector.js';
import { formatPathForDisplay } from '../utils/formatters.js';
import { resolveDeclaredPath } from '../utils/path-resolution.js';
import { RESOURCE_TYPE_ORDER_PLURAL, normalizeType, toPluralKey } from '../core/resources/resource-registry.js';
import { renderResourceGroup, type TreeRenderConfig, type EnhancedFileMapping, type EnhancedResourceInfo, type EnhancedResourceGroup, type ResourceScope } from '../core/list/list-tree-renderer.js';

type FileStatus = 'tracked' | 'untracked' | 'missing';
type ResourceStatus = 'tracked' | 'partial' | 'untracked' | 'mixed';

interface ListOptions {
  global?: boolean;
  project?: boolean;
  all?: boolean;
  files?: boolean;
  tracked?: boolean;
  untracked?: boolean;
  platforms?: string[];
  remote?: boolean;
  profile?: string;
  apiKey?: string;
  deps?: boolean;
}

interface ScopeResult {
  headerName: string;
  headerVersion: string | undefined;
  headerPath: string;
  headerType: 'workspace' | 'package' | 'resource';
  tree: ListTreeNode[];
  data: ListPipelineResult;
}

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function green(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

function red(text: string): string {
  return `${RED}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Shared formatting helpers
// ---------------------------------------------------------------------------

function formatPackageLine(pkg: ListPackageReport): string {
  const version = pkg.version && pkg.version !== '0.0.0' ? `@${pkg.version}` : '';

  let stateSuffix = '';
  if (pkg.state === 'missing') {
    stateSuffix = dim(' (missing)');
  }

  return `${pkg.name}${version}${stateSuffix}`;
}

function formatFilePath(file: EnhancedFileMapping): string {
  if (file.scope === 'global' && !file.target.startsWith('~')) {
    return `~/${file.target}`;
  }
  return file.target;
}

function formatScopeBadges(scopes: Set<ResourceScope>): string {
  const sorted = Array.from(scopes).sort();
  const badges = sorted.map(s => s === 'project' ? 'p' : 'g').join(', ');
  return dim(`[${badges}]`);
}

// ---------------------------------------------------------------------------
// Remote package detail helper (used when package not found locally)
// ---------------------------------------------------------------------------

function printFileList(
  files: { source: string; target: string; exists: boolean }[],
  prefix: string
): void {
  const sortedFiles = [...files].sort((a, b) => a.target.localeCompare(b.target));

  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const isLast = i === sortedFiles.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const label = file.exists
      ? dim(file.target)
      : `${dim(file.target)} ${red('[MISSING]')}`;
    console.log(`${prefix}${connector}${label}`);
  }
}

function printResourceGroups(
  groups: ListResourceGroup[],
  prefix: string,
  showFiles: boolean
): void {
  const config: TreeRenderConfig<ListFileMapping> = {
    formatPath: (file) => file.target,
    isMissing: (file) => !file.exists,
    sortFiles: (a, b) => a.target.localeCompare(b.target)
  };
  
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const isLastGroup = gi === groups.length - 1;
    renderResourceGroup(group, prefix, isLastGroup, showFiles, config);
  }
}

function printRemotePackageDetail(
  result: RemoteListResult,
  showFiles: boolean,
  showDeps: boolean
): void {
  const pkg = result.package;
  console.log(`${formatPackageLine(pkg)} ${dim(`(${result.sourceLabel})`)} ${dim('[remote]')}`);

  // Show resource groups if available (preferred view)
  if (pkg.resourceGroups && pkg.resourceGroups.length > 0) {
    printResourceGroups(pkg.resourceGroups, '', showFiles);
  } 
  // Fallback to file list if no resource groups but files exist
  else if (pkg.fileList && pkg.fileList.length > 0) {
    printFileList(pkg.fileList, '');
  }
  // If no content available at all, show a message
  else if (pkg.totalFiles === 0) {
    console.log(dim('  (no files)'));
  }

  if (showDeps && result.dependencies.length > 0) {
    console.log();
    console.log('Dependencies:');
    result.dependencies.forEach((dep, index) => {
      const isLast = index === result.dependencies.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const versionSuffix = dep.version ? `@${dep.version}` : '';
      console.log(`${connector}${dep.name}${versionSuffix}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Deps view (`opkg list --deps`)
// ---------------------------------------------------------------------------

function printDepTreeNode(
  node: ListTreeNode,
  prefix: string,
  isLast: boolean,
  showFiles: boolean
): void {
  const hasChildren = node.children.length > 0;
  const hasResources = showFiles && node.report.resourceGroups && node.report.resourceGroups.length > 0;
  const hasBranches = hasChildren || hasResources;

  const connector = isLast
    ? (hasBranches ? '└─┬ ' : '└── ')
    : (hasBranches ? '├─┬ ' : '├── ');
  const childPrefix = prefix + (isLast ? '  ' : '│ ');

  console.log(`${prefix}${connector}${formatPackageLine(node.report)}`);

  if (hasResources) {
    const groups = node.report.resourceGroups!;
    const config: TreeRenderConfig<ListFileMapping> = {
      formatPath: (file) => file.target,
      isMissing: (file) => !file.exists,
      sortFiles: (a, b) => a.target.localeCompare(b.target)
    };
    
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const isLastGroup = gi === groups.length - 1 && !hasChildren;
      renderResourceGroup(group, childPrefix, isLastGroup, true, config);
    }
  }

  node.children.forEach((child, index) => {
    const isLastChild = index === node.children.length - 1;
    printDepTreeNode(child, childPrefix, isLastChild, showFiles);
  });
}

interface DepsPackageEntry {
  report: ListPackageReport;
  children: ListTreeNode[];
  scopes: Set<ResourceScope>;
}

function printDepsView(
  results: Array<{ scope: ResourceScope; result: ScopeResult }>,
  showFiles: boolean
): void {
  const packageMap = new Map<string, DepsPackageEntry>();

  for (const { scope, result } of results) {
    for (const node of result.tree) {
      const key = node.report.name;
      if (packageMap.has(key)) {
        packageMap.get(key)!.scopes.add(scope);
      } else {
        packageMap.set(key, {
          report: node.report,
          children: node.children,
          scopes: new Set([scope])
        });
      }
    }
  }

  if (packageMap.size === 0) {
    console.log(dim('No packages installed.'));
    return;
  }

  // Print header showing workspace/package name and path
  if (results.length > 0) {
    const firstResult = results[0].result;
    const version = firstResult.headerVersion ? `@${firstResult.headerVersion}` : '';
    const typeTag = dim(`[${firstResult.headerType}]`);
    console.log(`${firstResult.headerName}${version} ${dim(`(${firstResult.headerPath})`)} ${typeTag}`);
  }

  const entries = Array.from(packageMap.values())
    .sort((a, b) => a.report.name.localeCompare(b.report.name));

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const hasChildren = entry.children.length > 0;
    const hasResources = showFiles && entry.report.resourceGroups && entry.report.resourceGroups.length > 0;
    const hasBranches = hasChildren || hasResources;

    const scopeBadge = formatScopeBadges(entry.scopes);
    const connector = isLast
      ? (hasBranches ? '└─┬ ' : '└── ')
      : (hasBranches ? '├─┬ ' : '├── ');
    const childPrefix = isLast ? '  ' : '│ ';

    console.log(`${connector}${formatPackageLine(entry.report)} ${scopeBadge}`);

    // Show resource groups for the top-level package if files are requested
    if (hasResources) {
      const groups = entry.report.resourceGroups!;
      const config: TreeRenderConfig<ListFileMapping> = {
        formatPath: (file) => file.target,
        isMissing: (file) => !file.exists,
        sortFiles: (a, b) => a.target.localeCompare(b.target)
      };
      
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        const isLastGroup = gi === groups.length - 1 && !hasChildren;
        renderResourceGroup(group, childPrefix, isLastGroup, true, config);
      }
    }

    for (let ci = 0; ci < entry.children.length; ci++) {
      const child = entry.children[ci];
      const isLastChild = ci === entry.children.length - 1;
      printDepTreeNode(child, childPrefix, isLastChild, showFiles);
    }
  }
}

// ---------------------------------------------------------------------------
// Resources view (default: `opkg list`)
// ---------------------------------------------------------------------------

function deriveResourceNameFromUntrackedFile(file: UntrackedFile): string {
  const parts = file.workspacePath.split('/');
  const fileName = parts[parts.length - 1];

  if (fileName === 'SKILL.md' && parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return fileName.replace(/\.[^.]+$/, '') || fileName;
}

function normalizeCategory(category: string): string {
  return toPluralKey(normalizeType(category));
}

function calculateResourceStatus(files: EnhancedFileMapping[]): ResourceStatus {
  if (files.length === 0) return 'untracked';

  const hasTracked = files.some(f => f.status === 'tracked');
  const hasUntracked = files.some(f => f.status === 'untracked');
  const hasMissing = files.some(f => f.status === 'missing');

  if (hasUntracked && !hasTracked && !hasMissing) return 'untracked';
  if (hasTracked && !hasUntracked && !hasMissing) return 'tracked';
  if (hasTracked && hasMissing && !hasUntracked) return 'partial';
  return 'mixed';
}

function mergeTrackedAndUntrackedResources(
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
          if (!resourcesMap.has(resource.name)) {
            const enhancedFiles: EnhancedFileMapping[] = resource.files.map(f => ({
              ...f,
              status: f.exists ? 'tracked' as FileStatus : 'missing' as FileStatus,
              scope
            }));

            resourcesMap.set(resource.name, {
              name: resource.name,
              resourceType: resource.resourceType,
              files: enhancedFiles,
              status: 'tracked',
              scopes: new Set([scope])
            });
          }
        }
      }
    }
    node.children.forEach(collectFromNode);
  }

  tree.forEach(collectFromNode);

  if (untrackedFiles && untrackedFiles.files.length > 0) {
    for (const file of untrackedFiles.files) {
      const resourceName = deriveResourceNameFromUntrackedFile(file);
      const normalizedType = normalizeCategory(file.category);

      if (!typeMap.has(normalizedType)) {
        typeMap.set(normalizedType, new Map());
      }
      const resourcesMap = typeMap.get(normalizedType)!;

      // For 'other' type, use a fixed resource name to consolidate all files
      const finalResourceName = normalizedType === 'other' ? 'uncategorized' : resourceName;
      const resourceKey = normalizedType === 'other' ? 'uncategorized' : resourceName;

      const enhancedFile: EnhancedFileMapping = {
        source: file.workspacePath,
        target: file.workspacePath,
        exists: true,
        status: 'untracked',
        scope
      };

      if (!resourcesMap.has(resourceKey)) {
        resourcesMap.set(resourceKey, {
          name: finalResourceName,
          resourceType: normalizedType,
          files: [enhancedFile],
          status: 'untracked',
          scopes: new Set([scope])
        });
      } else {
        resourcesMap.get(resourceKey)!.files.push(enhancedFile);
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

function mergeResourcesAcrossScopes(
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
            files: [...resource.files]
          });
        } else {
          const existing = resourcesMap.get(resource.name)!;
          existing.scopes.add(scope);
          existing.files.push(...resource.files);
          existing.status = calculateResourceStatus(existing.files);
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

function printResourcesView(
  groups: EnhancedResourceGroup[],
  showFiles: boolean,
  headerInfo?: { name: string; version?: string; path: string; type: 'workspace' | 'package' | 'resource' }
): void {
  // Print header showing workspace/package name and path if provided
  if (headerInfo) {
    const version = headerInfo.version ? `@${headerInfo.version}` : '';
    const typeTag = dim(`[${headerInfo.type}]`);
    console.log(`${headerInfo.name}${version} ${dim(`(${headerInfo.path})`)} ${typeTag}`);
  }

  // Configure for EnhancedFileMapping with scope badges
  const config: TreeRenderConfig<EnhancedFileMapping> = {
    formatPath: (file) => formatFilePath(file),
    isMissing: (file) => file.status === 'missing',
    sortFiles: (a, b) => {
      const pathA = formatFilePath(a);
      const pathB = formatFilePath(b);
      return pathA.localeCompare(pathB);
    },
    getResourceBadge: (scopes) => scopes ? formatScopeBadges(scopes) : ''
  };

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const isLastGroup = gi === groups.length - 1;
    renderResourceGroup(group, '', isLastGroup, showFiles, config);
  }
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

async function runScopeList(
  packageName: string | undefined,
  execContext: ExecutionContext,
  options: ListOptions
): Promise<ScopeResult | null> {
  const skipLocal = options.remote && !!packageName;

  let packages: ListPackageReport[] = [];
  let tree: ListTreeNode[] = [];
  let data: ListPipelineResult | undefined;

  if (!skipLocal) {
    const result = await runListPipeline(packageName, execContext, {
      includeFiles: options.files || !!packageName,
      all: options.all,
      tracked: options.tracked,
      untracked: options.untracked,
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

async function resolveRemoteListForPackage(
  packageName: string,
  execContext: ExecutionContext,
  options: ListOptions
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
    logger.debug(`Remote list resolution failed for '${packageName}': ${error}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

async function listCommand(
  packageName: string | undefined,
  options: ListOptions,
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};

  if (options.tracked && options.untracked) {
    throw new ValidationError('Cannot use --tracked and --untracked together.');
  }

  if (packageName && options.untracked) {
    throw new ValidationError('Cannot use --untracked with a specific package.');
  }

  if (options.all && options.untracked) {
    throw new ValidationError('Cannot use --all with --untracked.');
  }

  if (options.global && options.project) {
    throw new ValidationError('Cannot use --global and --project together.');
  }

  if (options.deps && options.untracked) {
    throw new ValidationError('Cannot use --deps with --untracked.');
  }

  // --- Package detail view ---
  if (packageName) {
    const showBothScopes = !options.global && !options.project;
    const showGlobal = options.global || showBothScopes;
    const showProject = options.project || showBothScopes;

    const results: { scope: ResourceScope; result: ScopeResult }[] = [];

    if (showProject) {
      const projectContext = await createExecutionContext({
        global: false,
        cwd: programOpts.cwd
      });
      try {
        const projectResult = await runScopeList(packageName, projectContext, options);
        if (projectResult) {
          results.push({ scope: 'project', result: projectResult });
        }
      } catch (error) {
        logger.debug(`Failed to list project scope for package '${packageName}': ${error}`);
      }
    }

    if (showGlobal) {
      const globalContext = await createExecutionContext({
        global: true,
        cwd: programOpts.cwd
      });
      try {
        const globalResult = await runScopeList(packageName, globalContext, options);
        if (globalResult) {
          results.push({ scope: 'global', result: globalResult });
        }
      } catch (error) {
        logger.debug(`Failed to list global scope for package '${packageName}': ${error}`);
      }
    }

    if (results.length === 0) {
      // Try remote as fallback
      const fallbackContext = await createExecutionContext({
        global: options.global,
        cwd: programOpts.cwd
      });
      const remoteResult = await resolveRemoteListForPackage(packageName, fallbackContext, options);
      if (remoteResult) {
        printRemotePackageDetail(remoteResult, !!options.files, !!options.deps);
        return { success: true };
      }
      throw new ValidationError(`Package '${packageName}' not found locally or remotely`);
    }

    // --- Deps view for specific package ---
    if (options.deps) {
      printDepsView(results, !!options.files);
      return { success: true };
    }

    // --- Resources view for specific package (default) ---
    const scopedResources: Array<{ scope: ResourceScope; groups: EnhancedResourceGroup[] }> = [];

    for (const { scope, result } of results) {
      // Don't include untracked files when listing a specific package
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

    // Get header info from the target package
    const firstResult = results[0].result;
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

    printResourcesView(mergedResources, !!options.files, headerInfo);

    return { success: true };
  }

  // --- List views (no specific package) ---
  const showBothScopes = !options.global && !options.project;
  const showGlobal = options.global || showBothScopes;
  const showProject = options.project || showBothScopes;

  const results: { scope: ResourceScope; result: ScopeResult }[] = [];

  if (showProject) {
    const projectContext = await createExecutionContext({
      global: false,
      cwd: programOpts.cwd
    });
    try {
      const projectResult = await runScopeList(packageName, projectContext, options);
      if (projectResult) {
        results.push({ scope: 'project', result: projectResult });
      }
    } catch (error) {
      logger.debug(`Failed to list project scope: ${error}`);
    }
  }

  if (showGlobal) {
    const globalContext = await createExecutionContext({
      global: true,
      cwd: programOpts.cwd
    });
    try {
      const globalResult = await runScopeList(packageName, globalContext, options);
      if (globalResult) {
        results.push({ scope: 'global', result: globalResult });
      }
    } catch (error) {
      logger.debug(`Failed to list global scope: ${error}`);
    }
  }

  if (results.length === 0) {
    if (options.deps) {
      console.log(dim('No packages installed.'));
    } else {
      console.log(dim('No resources found.'));
    }
    return { success: true };
  }

  // --- Deps view ---
  if (options.deps) {
    printDepsView(results, !!options.files);
    return { success: true };
  }

  // --- Resources view (default) ---
  const scopedResources: Array<{ scope: ResourceScope; groups: EnhancedResourceGroup[] }> = [];

  for (const { scope, result } of results) {
    const untrackedData = options.tracked ? undefined : result.data.untrackedFiles;
    const merged = mergeTrackedAndUntrackedResources(result.tree, untrackedData, scope);
    if (merged.length > 0) {
      scopedResources.push({ scope, groups: merged });
    }
  }

  if (scopedResources.length === 0) {
    if (options.untracked) {
      console.log(dim('No untracked resources found.'));
    } else {
      console.log(dim('No resources found.'));
    }
    return { success: true };
  }

  let mergedResources = mergeResourcesAcrossScopes(scopedResources);

  if (options.untracked) {
    mergedResources = mergedResources
      .map(group => ({
        ...group,
        resources: group.resources.filter(r => r.status === 'untracked')
      }))
      .filter(group => group.resources.length > 0);

    if (mergedResources.length === 0) {
      console.log(dim('No untracked resources found.'));
      return { success: true };
    }
  }

  // Get header info from the first result
  const headerInfo = results.length > 0 
    ? { 
        name: results[0].result.headerName, 
        version: results[0].result.headerVersion, 
        path: results[0].result.headerPath,
        type: results[0].result.headerType
      }
    : undefined;

  printResourcesView(mergedResources, !!options.files, headerInfo);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Commander setup
// ---------------------------------------------------------------------------

export function setupListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List installed resources and packages')
    .argument('[resource-spec]', 'show details for a specific resource')
    .option('-p, --project', 'list in current workspace only')
    .option('-g, --global', 'list in home directory (~/) only')
    .option('-d, --deps', 'show dependency tree instead of resources')
    .option('-a, --all', 'show full dependency tree including transitive dependencies')
    .option('-f, --files', 'show individual file paths')
    .option('-t, --tracked', 'show only tracked resources (skip untracked scan)')
    .option('-u, --untracked', 'show only untracked resources')
    .option('--platforms <platforms...>', 'filter by specific platforms (e.g., cursor, claude)')
    .option('--remote', 'fetch package info from remote registry or git, skipping local lookup')
    .option('--profile <profile>', 'profile to use for authentication')
    .option('--api-key <key>', 'API key for authentication (overrides profile)')
    .action(withErrorHandling(async (packageName: string | undefined, options: ListOptions, command: Command) => {
      await listCommand(packageName, options, command);
    }));
}
