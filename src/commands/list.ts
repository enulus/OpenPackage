import { Command } from 'commander';

import { CommandResult, type ExecutionContext } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { runListPipeline, type ListPackageReport, type ListTreeNode, type ListPipelineResult } from '../core/list/list-pipeline.js';
import { logger } from '../utils/logger.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { getLocalPackageYmlPath } from '../utils/paths.js';
import { createExecutionContext, getDisplayTargetDir } from '../core/execution-context.js';
import type { UntrackedScanResult } from '../core/list/untracked-files-scanner.js';
import { classifyInput } from '../core/install/preprocessing/index.js';
import { resolveRemoteList, type RemoteListResult } from '../core/list/remote-list-resolver.js';

interface ListOptions {
  global?: boolean;
  all?: boolean;
  files?: boolean;
  tracked?: boolean;
  untracked?: boolean;
  platforms?: string[];
  remote?: boolean;
  profile?: string;
  apiKey?: string;
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

function formatPackageLine(pkg: ListPackageReport): string {
  const version = pkg.version && pkg.version !== '0.0.0' ? `@${pkg.version}` : '';

  let fileCount = '';
  if (pkg.totalFiles > 0) {
    fileCount = dim(` (${pkg.totalFiles})`);
  }

  let stateSuffix = '';
  if (pkg.state === 'missing') {
    stateSuffix = dim(' (missing)');
  }

  return `${pkg.name}${version}${stateSuffix}${fileCount}`;
}

function printFileList(
  files: { source: string; target: string; exists: boolean }[],
  prefix: string
): void {
  // Sort files alphabetically by target path
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

function printTreeNode(
  node: ListTreeNode,
  prefix: string,
  isLast: boolean,
  showFiles: boolean
): void {
  const hasChildren = node.children.length > 0;
  const hasFiles = showFiles && node.report.fileList && node.report.fileList.length > 0;
  const hasBranches = hasChildren || hasFiles;

  const connector = isLast
    ? (hasBranches ? '└─┬ ' : '└── ')
    : (hasBranches ? '├─┬ ' : '├── ');
  const childPrefix = prefix + (isLast ? '  ' : '│ ');

  console.log(`${prefix}${connector}${formatPackageLine(node.report)}`);

  if (hasFiles) {
    const files = node.report.fileList!;
    const filePrefix = node.children.length > 0 ? '│ ' : '  ';
    printFileList(files, childPrefix);
  }

  node.children.forEach((child, index) => {
    const isLastChild = index === node.children.length - 1;
    printTreeNode(child, childPrefix, isLastChild, showFiles);
  });
}

function printUntrackedSummary(result: UntrackedScanResult): void {
  if (result.totalFiles === 0) return;

  const platformCounts: string[] = [];
  const sortedPlatforms = Array.from(result.platformGroups.keys()).sort();
  for (const platform of sortedPlatforms) {
    const files = result.platformGroups.get(platform)!;
    platformCounts.push(`${platform}${dim(` (${files.length})`)}`);
  }

  console.log(`Untracked:`);
  console.log(`  ${platformCounts.join('\n  ')}`);
}

function printUntrackedExpanded(result: UntrackedScanResult): void {
  if (result.totalFiles === 0) {
    console.log('No untracked files detected.');
    console.log(dim('All files matching platform patterns are tracked in the index.'));
    return;
  }

  console.log(`Untracked:`);

  const sortedPlatforms = Array.from(result.platformGroups.keys()).sort();

  for (const platform of sortedPlatforms) {
    const files = result.platformGroups.get(platform)!;
    console.log(`${platform}${dim(` (${files.length})`)}`);

    // Sort files alphabetically by workspace path
    const sortedFiles = [...files].sort((a, b) => a.workspacePath.localeCompare(b.workspacePath));

    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const isLast = i === sortedFiles.length - 1;
      const prefix = isLast ? '└── ' : '├── ';
      console.log(`${prefix}${dim(file.workspacePath)}`);
    }
  }
}

function printDefaultView(
  headerName: string,
  headerVersion: string | undefined,
  headerPath: string,
  tree: ListTreeNode[],
  data: ListPipelineResult,
  showFiles: boolean
): void {
  const version = headerVersion && headerVersion !== '0.0.0' ? `@${headerVersion}` : '';
  console.log(`${headerName}${version} ${headerPath}`);

  if (tree.length === 0) {
    console.log(dim('  No packages installed.'));
    return;
  }

  tree.forEach((node, index) => {
    const isLast = index === tree.length - 1;
    printTreeNode(node, '', isLast, showFiles);
  });

  if (data.untrackedFiles && data.untrackedFiles.totalFiles > 0) {
    if (showFiles) {
      console.log();
      printUntrackedExpanded(data.untrackedFiles);
    } else {
      console.log();
      printUntrackedSummary(data.untrackedFiles);
    }
  }
}

function printTrackedView(
  headerName: string,
  headerVersion: string | undefined,
  headerPath: string,
  tree: ListTreeNode[],
  data: ListPipelineResult,
  showFiles: boolean
): void {
  const version = headerVersion && headerVersion !== '0.0.0' ? `@${headerVersion}` : '';
  console.log(`${headerName}${version} ${headerPath}`);

  if (tree.length === 0) {
    console.log(dim('  No packages installed.'));
    return;
  }

  tree.forEach((node, index) => {
    const isLast = index === tree.length - 1;
    printTreeNode(node, '', isLast, showFiles);
  });
}

function printUntrackedView(
  data: ListPipelineResult,
  showFiles: boolean
): void {
  if (!data.untrackedFiles || data.untrackedFiles.totalFiles === 0) {
    console.log('No untracked files detected.');
    console.log(dim('All files matching platform patterns are tracked in the index.'));
    return;
  }

  if (showFiles) {
    printUntrackedExpanded(data.untrackedFiles);
  } else {
    printUntrackedSummary(data.untrackedFiles);
  }
}

function printPackageDetail(
  targetPackage: ListPackageReport,
  tree: ListTreeNode[],
  data: ListPipelineResult,
  showFiles: boolean
): void {
  console.log(formatPackageLine(targetPackage));

  if (targetPackage.fileList && targetPackage.fileList.length > 0) {
    printFileList(targetPackage.fileList, '');
  }

  if (tree.length > 0) {
    console.log();
    console.log('Dependencies:');
    tree.forEach((node, index) => {
      const isLast = index === tree.length - 1;
      printTreeNode(node, '', isLast, showFiles);
    });
  }
}

function printRemotePackageDetail(
  result: RemoteListResult,
  showFiles: boolean
): void {
  const pkg = result.package;
  console.log(`${formatPackageLine(pkg)} ${dim(`[${result.sourceLabel}]`)}`);

  if (showFiles && pkg.fileList && pkg.fileList.length > 0) {
    printFileList(pkg.fileList, '');
  }

  if (result.dependencies.length > 0) {
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

async function listCommand(
  packageName: string | undefined,
  options: ListOptions,
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};

  const execContext = await createExecutionContext({
    global: options.global,
    cwd: programOpts.cwd
  });

  const displayDir = getDisplayTargetDir(execContext);

  if (options.tracked && options.untracked) {
    throw new ValidationError('Cannot use --tracked and --untracked together.');
  }

  if (packageName && options.untracked) {
    throw new ValidationError('Cannot use --untracked with a specific package.');
  }

  if (options.all && options.untracked) {
    throw new ValidationError('Cannot use --all with --untracked.');
  }

  const skipLocal = options.remote && !!packageName;

  let result: CommandResult<ListPipelineResult> | undefined;
  let packages: ListPackageReport[] = [];
  let tree: ListTreeNode[] = [];
  let data: ListPipelineResult | undefined;

  if (!skipLocal) {
    result = await runListPipeline(packageName, execContext, {
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

  if (packageName && (skipLocal || packages.length === 0)) {
    const remoteResult = await resolveRemoteListForPackage(packageName, execContext, options);
    if (remoteResult) {
      printRemotePackageDetail(remoteResult, !!options.files);
      return { success: true };
    }
    throw new ValidationError(`Package '${packageName}' not found locally or remotely`);
  }

  if (packageName && data?.targetPackage) {
    printPackageDetail(data.targetPackage, tree, data, !!options.files);
    return { success: true };
  }

  if (options.untracked) {
    printUntrackedView(data!, !!options.files);
    return { success: true };
  }

  let headerName: string;
  let headerVersion: string | undefined;
  let headerPath: string;

  const manifestPath = getLocalPackageYmlPath(execContext.targetDir);
  headerName = 'Unnamed';
  headerPath = displayDir;

  try {
    const manifest = await parsePackageYml(manifestPath);
    headerName = manifest.name || 'Unnamed';
    headerVersion = manifest.version;
  } catch (error) {
    logger.warn(`Failed to read workspace manifest: ${error}`);
  }

  if (options.tracked) {
    printTrackedView(headerName, headerVersion, headerPath, tree, data!, !!options.files);
  } else {
    printDefaultView(headerName, headerVersion, headerPath, tree, data!, !!options.files);
  }

  return { success: true };
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

export function setupListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('Show installed packages, file status, and untracked files')
    .argument('[package]', 'show details for a specific package')
    .option('-g, --global', 'list packages in home directory (~/) instead of current workspace')
    .option('-a, --all', 'show full dependency tree including transitive dependencies')
    .option('-f, --files', 'show individual files for each package')
    .option('-t, --tracked', 'show only tracked file information (skip untracked scan)')
    .option('-u, --untracked', 'show only untracked files detected by platforms')
    .option('--platforms <platforms...>', 'filter by specific platforms (e.g., cursor, claude)')
    .option('--remote', 'fetch package info from remote registry or git, skipping local lookup')
    .option('--profile <profile>', 'profile to use for authentication')
    .option('--api-key <key>', 'API key for authentication (overrides profile)')
    .action(withErrorHandling(async (packageName: string | undefined, options: ListOptions, command: Command) => {
      await listCommand(packageName, options, command);
    }));
}
