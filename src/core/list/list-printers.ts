import type { ListPackageReport, ListTreeNode, ListResourceGroup, ListFileMapping } from './list-pipeline.js';
import type { RemoteListResult } from './remote-list-resolver.js';
import { renderResourceGroup, type TreeRenderConfig, type EnhancedFileMapping, type EnhancedResourceGroup, type ResourceScope } from './list-tree-renderer.js';
import { formatScopeBadge } from '../../utils/formatters.js';
import type { ScopeResult, HeaderInfo } from './scope-data-collector.js';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const RED = '\x1b[31m';

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function red(text: string): string {
  return `${RED}${text}${RESET}`;
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

// ---------------------------------------------------------------------------
// Remote package detail
// ---------------------------------------------------------------------------

export function printRemotePackageDetail(
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

export function printDepsView(
  results: Array<{ scope: ResourceScope; result: ScopeResult }>,
  showFiles: boolean,
  headerInfo?: HeaderInfo
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
  if (headerInfo) {
    const version = headerInfo.version ? `@${headerInfo.version}` : '';
    const typeTag = dim(`[${headerInfo.type}]`);
    console.log(`${headerInfo.name}${version} ${dim(`(${headerInfo.path})`)} ${typeTag}`);
  } else if (results.length > 0) {
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

    const scopeBadge = dim(formatScopeBadge(entry.scopes));
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
// Resources view (default)
// ---------------------------------------------------------------------------

export function printResourcesView(
  groups: EnhancedResourceGroup[],
  showFiles: boolean,
  headerInfo?: HeaderInfo,
  options?: { showScopeBadges?: boolean }
): void {
  // Print header showing workspace/package name and path if provided
  if (headerInfo) {
    const version = headerInfo.version ? `@${headerInfo.version}` : '';
    const typeTag = dim(`[${headerInfo.type}]`);
    console.log(`${headerInfo.name}${version} ${dim(`(${headerInfo.path})`)} ${typeTag}`);
  }

  const showScopeBadges = options?.showScopeBadges !== false;

  const config: TreeRenderConfig<EnhancedFileMapping> = {
    formatPath: (file) => formatFilePath(file),
    isMissing: (file) => file.status === 'missing',
    sortFiles: (a, b) => {
      const pathA = formatFilePath(a);
      const pathB = formatFilePath(b);
      return pathA.localeCompare(pathB);
    },
    ...(showScopeBadges && {
      getResourceBadge: (scopes) => scopes ? dim(formatScopeBadge(scopes)) : ''
    })
  };

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const isLastGroup = gi === groups.length - 1;
    renderResourceGroup(group, '', isLastGroup, showFiles, config);
  }
}
