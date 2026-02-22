import type { ListPackageReport, ListTreeNode, ListResourceGroup, ListFileMapping } from './list-pipeline.js';
import type { RemoteListResult } from './remote-list-resolver.js';
import { flattenResourceGroups, renderFlatResourceList, getChildPrefix, type TreeRenderConfig, type EnhancedFileMapping, type EnhancedResourceGroup, type EnhancedResourceInfo, type ResourceScope } from './list-tree-renderer.js';
import { formatScopeBadge, formatPathForDisplay } from '../../utils/formatters.js';
import type { ScopeResult, HeaderInfo } from './scope-data-collector.js';
import type { ViewMetadataEntry } from './view-metadata.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

export type { ViewMetadataEntry } from './view-metadata.js';
export { extractMetadataFromManifest } from './view-metadata.js';

export function printMetadataSection(metadata: ViewMetadataEntry[], output?: OutputPort): void {
  const out = output ?? resolveOutput();
  out.info(sectionHeader('Metadata', metadata.length));
  metadata.forEach((entry) => {
    const valueStr = Array.isArray(entry.value)
      ? entry.value.join(', ')
      : String(entry.value);
    out.info(`${dim(entry.key + ':')} ${valueStr}`);
  });
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export function cyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

function red(text: string): string {
  return `${RED}${text}${RESET}`;
}

export function sectionHeader(title: string, count: number): string {
  return `${cyan(`[${title}]`)} ${dim(`(${count})`)}`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
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

// ---------------------------------------------------------------------------
// File and resource group printing
// ---------------------------------------------------------------------------

function printFileList(
  files: { source: string; target: string; exists: boolean }[],
  prefix: string,
  out: OutputPort
): void {
  const sortedFiles = [...files].sort((a, b) => a.target.localeCompare(b.target));

  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const isLast = i === sortedFiles.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const label = file.exists
      ? dim(file.target)
      : `${dim(file.target)} ${red('[MISSING]')}`;
    out.info(`${prefix}${connector}${label}`);
  }
}

/** Config for rendering ListFileMapping (deps view, remote package detail) */
const LIST_FILE_CONFIG: TreeRenderConfig<ListFileMapping> = {
  formatPath: (file) => file.target,
  isMissing: (file) => !file.exists,
  sortFiles: (a, b) => a.target.localeCompare(b.target)
};

function printResourceGroups(
  groups: ListResourceGroup[],
  prefix: string,
  showFiles: boolean
): void {
  const flatResources = flattenResourceGroups(groups);
  renderFlatResourceList(flatResources, prefix, showFiles, LIST_FILE_CONFIG);
}

// ---------------------------------------------------------------------------
// Remote package detail
// ---------------------------------------------------------------------------

export function printRemotePackageDetail(
  result: RemoteListResult,
  showFiles: boolean,
  showDeps: boolean,
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
  const pkg = result.package;
  out.info(`${formatPackageLine(pkg)} ${dim(`(${result.sourceLabel})`)} ${dim('[remote]')}`);

  // [Metadata] section (first)
  const metadata = result.metadata ?? [];
  printMetadataSection(metadata, out);

  // Resource count: from groups (flattened), file list, or 0
  const resourceCount = pkg.resourceGroups && pkg.resourceGroups.length > 0
    ? flattenResourceGroups(pkg.resourceGroups).length
    : (pkg.fileList?.length ?? 0);
  out.info(sectionHeader('Resources', resourceCount));

  // Show resource groups if available (preferred view)
  if (pkg.resourceGroups && pkg.resourceGroups.length > 0) {
    printResourceGroups(pkg.resourceGroups, '', showFiles);
  }
  // Fallback to file list if no resource groups but files exist
  else if (pkg.fileList && pkg.fileList.length > 0) {
    printFileList(pkg.fileList, '', out);
  }
  // If no content available at all, show a message
  else if (pkg.totalFiles === 0) {
    out.info(dim('└── (no files)'));
  }

  if (showDeps) {
    out.info(sectionHeader('Dependencies', result.dependencies.length));
    result.dependencies.forEach((dep, index) => {
      const isLast = index === result.dependencies.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const versionSuffix = dep.version ? `@${dep.version}` : '';
      out.info(`${connector}${dep.name}${versionSuffix}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Deps view
// ---------------------------------------------------------------------------

interface DepsPackageEntry {
  report: ListPackageReport;
  children: ListTreeNode[];
  scopes: Set<ResourceScope>;
}

function printDepTreeNode(
  node: ListTreeNode,
  prefix: string,
  isLast: boolean,
  showFiles: boolean,
  out: OutputPort
): void {
  const hasChildren = node.children.length > 0;
  const hasFiles = showFiles && node.report.fileList && node.report.fileList.length > 0;
  const hasBranches = hasChildren || hasFiles;

  const connector = isLast
    ? (hasBranches ? '└─┬ ' : '└── ')
    : (hasBranches ? '├─┬ ' : '├── ');
  const childPrefix = getChildPrefix(prefix, isLast);

  out.info(`${prefix}${connector}${formatPackageLine(node.report)}`);

  if (hasFiles) {
    printFileList(node.report.fileList!, childPrefix, out);
  }

  node.children.forEach((child, index) => {
    const isLastChild = index === node.children.length - 1;
    printDepTreeNode(child, childPrefix, isLastChild, showFiles, out);
  });
}

export function printDepsView(
  results: Array<{ scope: ResourceScope; result: ScopeResult }>,
  showFiles: boolean,
  headerInfo?: HeaderInfo,
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
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
    out.info(dim('No packages installed.'));
    return;
  }

  // Option 1: When workspace is the header, exclude it from the tree to avoid duplication.
  // Its files are shown under the header when -f is used.
  let workspaceEntry: DepsPackageEntry | undefined;
  if (headerInfo?.type === 'workspace' && headerInfo.name) {
    workspaceEntry = packageMap.get(headerInfo.name);
    if (workspaceEntry) {
      packageMap.delete(headerInfo.name);
    }
  }

  // Print header showing workspace/package name and path
  if (headerInfo) {
    const version = headerInfo.version ? `@${headerInfo.version}` : '';
    const typeTag = dim(`[${headerInfo.type}]`);
    out.info(`${headerInfo.name}${version} ${dim(`(${headerInfo.path})`)} ${typeTag}`);
  } else if (results.length > 0) {
    const firstResult = results[0].result;
    const version = firstResult.headerVersion ? `@${firstResult.headerVersion}` : '';
    const typeTag = dim(`[${firstResult.headerType}]`);
    out.info(`${firstResult.headerName}${version} ${dim(`(${firstResult.headerPath})`)} ${typeTag}`);
  }

  const entries = Array.from(packageMap.values())
    .sort((a, b) => a.report.name.localeCompare(b.report.name));

  out.info(sectionHeader('Dependencies', entries.length));

  // If workspace was excluded, show its files under the header when -f is used.
  // Use empty prefix so workspace files appear as siblings of dep entries.
  if (workspaceEntry && showFiles && workspaceEntry.report.fileList && workspaceEntry.report.fileList.length > 0) {
    printFileList(workspaceEntry.report.fileList, '', out);
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const hasChildren = entry.children.length > 0;
    const hasFiles = showFiles && entry.report.fileList && entry.report.fileList.length > 0;
    const hasBranches = hasChildren || hasFiles;

    const scopeBadge = dim(formatScopeBadge(entry.scopes));
    const connector = isLast
      ? (hasBranches ? '└─┬ ' : '└── ')
      : (hasBranches ? '├─┬ ' : '├── ');
    const childPrefix = getChildPrefix('', isLast);

    out.info(`${connector}${formatPackageLine(entry.report)} ${scopeBadge}`);

    // Show flat file list for the package when -f is requested
    if (hasFiles) {
      printFileList(entry.report.fileList!, childPrefix, out);
    }

    for (let ci = 0; ci < entry.children.length; ci++) {
      const child = entry.children[ci];
      const isLastChild = ci === entry.children.length - 1;
      printDepTreeNode(child, childPrefix, isLastChild, showFiles, out);
    }
  }
}

// ---------------------------------------------------------------------------
// Resources view (default)
// ---------------------------------------------------------------------------

export function printResourcesView(
  groups: EnhancedResourceGroup[],
  showFiles: boolean,
  headerInfo?: HeaderInfo,
  options?: {
    showScopeBadges?: boolean;
    pathBaseForDisplay?: string;
    metadata?: ViewMetadataEntry[];
  },
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
  // Print header showing workspace/package name and path if provided
  if (headerInfo) {
    const version = headerInfo.version ? `@${headerInfo.version}` : '';
    const typeTag = dim(`[${headerInfo.type}]`);
    out.info(`${headerInfo.name}${version} ${dim(`(${headerInfo.path})`)} ${typeTag}`);
  }

  // [Metadata] section (first, when provided)
  if (options?.metadata !== undefined) {
    printMetadataSection(options.metadata, out);
  }

  const showScopeBadges = options?.showScopeBadges !== false;
  const pathBase = options?.pathBaseForDisplay;

  // Show package label only when listing workspace (not a specific package).
  // Temporarily disabled behind feature flag; set OPKG_LIST_SHOW_PACKAGE_LABELS=true to enable.
  const showPackageLabels =
    headerInfo?.type !== 'package' &&
    process.env.OPKG_LIST_SHOW_PACKAGE_LABELS === 'true';

  const config: TreeRenderConfig<EnhancedFileMapping> = {
    formatPath: (file) =>
      pathBase ? formatPathForDisplay(file.target, pathBase) : formatFilePath(file),
    isMissing: (file) => file.status === 'missing',
    sortFiles: (a, b) => {
      const pathA = pathBase ? formatPathForDisplay(a.target, pathBase) : formatFilePath(a);
      const pathB = pathBase ? formatPathForDisplay(b.target, pathBase) : formatFilePath(b);
      return pathA.localeCompare(pathB);
    },
    ...(showScopeBadges && {
      getResourceBadge: (scopes) => scopes ? dim(formatScopeBadge(scopes)) : ''
    }),
    ...(showPackageLabels && {
      getResourcePackageLabels: (packages) => {
        if (!packages || packages.size === 0) return [];
        return Array.from(packages)
          .sort()
          .map((pkg) => dim(`(${pkg})`));
      }
    })
  };

  const flatResources = flattenResourceGroups(groups);
  out.info(sectionHeader('Installed', flatResources.length));
  renderFlatResourceList(flatResources, '', showFiles, config);
}
