import { Command } from 'commander';

import { CommandResult } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { runListPipeline, type ListPackageReport, type ListTreeNode } from '../core/list/list-pipeline.js';
import { logger } from '../utils/logger.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { getLocalPackageYmlPath } from '../utils/paths.js';
import { createExecutionContext, getDisplayTargetDir } from '../core/execution-context.js';

interface ListOptions {
  global?: boolean;
  all?: boolean;
  files?: boolean;
  untracked?: boolean;
}

// ANSI escape codes for styling
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function formatPackageName(pkg: ListPackageReport): string {
  const version = pkg.version && pkg.version !== '0.0.0' ? `@${pkg.version}` : '';
  
  let statusSuffix = '';
  if (pkg.state === 'partial') {
    statusSuffix = dim(` (partial ${pkg.existingFiles}/${pkg.totalFiles})`);
  } else if (pkg.state === 'missing') {
    statusSuffix = dim(' (missing)');
  }
  
  return `${pkg.name}${version}${statusSuffix}`;
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
  
  const connector = isLast ? (hasBranches ? '└─┬ ' : '└── ') : (hasBranches ? '├─┬ ' : '├── ');
  const childPrefix = prefix + (isLast ? '  ' : '│ ');
  
  console.log(`${prefix}${connector}${formatPackageName(node.report)}`);
  
  // Print files if available
  if (hasFiles) {
    const files = node.report.fileList!;
    files.forEach((file, fileIndex) => {
      const isLastFile = fileIndex === files.length - 1 && node.children.length === 0;
      const fileConnector = isLastFile ? '└── ' : '├── ';
      console.log(`${childPrefix}${fileConnector}${dim(`${file.source} → ${file.target}`)}`);
    });
  }
  
  // Print children (dependencies)
  node.children.forEach((child, index) => {
    const isLastChild = index === node.children.length - 1;
    printTreeNode(child, childPrefix, isLastChild, showFiles);
  });
}

function printTreeView(
  workspaceName: string,
  workspaceVersion: string | undefined,
  tree: ListTreeNode[],
  cwd: string,
  showFiles: boolean
): void {
  const version = workspaceVersion && workspaceVersion !== '0.0.0' ? `@${workspaceVersion}` : '';
  console.log(`${workspaceName}${version} ${cwd}`);
  
  if (tree.length === 0) {
    return;
  }

  tree.forEach((node, index) => {
    const isLast = index === tree.length - 1;
    printTreeNode(node, '', isLast, showFiles);
  });
}

function printUntrackedFiles(
  result: import('../core/list/untracked-files-scanner.js').UntrackedScanResult,
  cwd: string
): void {
  if (result.totalFiles === 0) {
    console.log('No untracked files detected.');
    return;
  }
  
  console.log(`Untracked files in ${cwd}`);
  console.log(`Found ${result.totalFiles} file(s) matching platform patterns but not tracked in index\n`);
  
  // Group by platform
  const sortedPlatforms = Array.from(result.platformGroups.keys()).sort();
  
  for (const platform of sortedPlatforms) {
    const files = result.platformGroups.get(platform)!;
    console.log(`${platform}:`);
    
    // Sub-group by category
    const categoryMap = new Map<string, typeof files>();
    for (const file of files) {
      if (!categoryMap.has(file.category)) {
        categoryMap.set(file.category, []);
      }
      categoryMap.get(file.category)!.push(file);
    }
    
    // Sort categories
    const sortedCategories = Array.from(categoryMap.keys()).sort();
    
    for (let catIdx = 0; catIdx < sortedCategories.length; catIdx++) {
      const category = sortedCategories[catIdx];
      const categoryFiles = categoryMap.get(category)!;
      const isLastCategory = catIdx === sortedCategories.length - 1;
      const catPrefix = isLastCategory ? '└─┬ ' : '├─┬ ';
      const catIndent = isLastCategory ? '  ' : '│ ';
      
      console.log(`${catPrefix}${category}/`);
      
      for (let fileIdx = 0; fileIdx < categoryFiles.length; fileIdx++) {
        const file = categoryFiles[fileIdx];
        const isLastFile = fileIdx === categoryFiles.length - 1;
        const filePrefix = isLastFile ? '└── ' : '├── ';
        
        console.log(`${catIndent}${filePrefix}${dim(file.workspacePath)}`);
      }
    }
    
    console.log(''); // Empty line between platforms
  }
}

async function listCommand(packageName: string | undefined, options: ListOptions, command: Command): Promise<CommandResult> {
  // Get program-level options (for --cwd)
  const programOpts = command.parent?.opts() || {};
  
  // Create execution context
  const execContext = await createExecutionContext({
    global: options.global,
    cwd: programOpts.cwd
  });
  
  const displayDir = getDisplayTargetDir(execContext);
  
  // Special handling for --untracked
  if (options.untracked) {
    logger.info(`Scanning for untracked files in: ${displayDir}`);
  } else {
    logger.info(`Listing packages for directory: ${displayDir}`);
  }

  try {
    // Run list pipeline with execution context
    const result = await runListPipeline(packageName, execContext, {
      includeFiles: options.files,
      all: options.all,
      untracked: options.untracked
    });
    
    // Handle --untracked output
    if (options.untracked && result.data?.untrackedFiles) {
      printUntrackedFiles(result.data.untrackedFiles, displayDir);
      return { success: true, data: { packages: [], tree: [] } };
    }

    const packages = result.data?.packages ?? [];
    const tree = result.data?.tree ?? [];
    const targetPackage = result.data?.targetPackage;

    if (packageName && packages.length === 0) {
      throw new ValidationError(`Package '${packageName}' not found in workspace index`);
    }

    // Determine header info - use target package if specified, otherwise workspace manifest
    let headerName: string;
    let headerVersion: string | undefined;
    let headerPath: string;

    if (targetPackage) {
      // Specific package requested - use it as the root
      headerName = targetPackage.name;
      headerVersion = targetPackage.version;
      headerPath = targetPackage.path;
    } else {
      // Workspace view
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
    }

    // Unified tree view
    printTreeView(headerName, headerVersion, tree, headerPath, !!options.files);

    return { success: true, data: { packages, tree } };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw error;
  }
}

export function setupListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('Show installed packages and files')
    .argument('[package]', 'Optional package name to show details for')
    .option('-g, --global', 'list packages installed in home directory (~/) instead of current workspace')
    .option('-a, --all', 'show full dependency tree including transitive dependencies')
    .option('-f, --files', 'show files installed from each package')
    .option('-u, --untracked', 'show files detected by platforms but not tracked in index')
    .action(withErrorHandling(async (packageName: string | undefined, options: ListOptions, command: Command) => {
      await listCommand(packageName, options, command);
    }));
}
