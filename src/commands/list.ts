import { Command } from 'commander';

import { CommandResult } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { runListPipeline, type ListPackageReport } from '../core/list/list-pipeline.js';
import { logger } from '../utils/logger.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { getLocalPackageYmlPath } from '../utils/paths.js';

// ANSI escape codes for styling
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function printTreeView(workspaceName: string, workspaceVersion: string | undefined, packages: ListPackageReport[], cwd: string): void {
  // Omit version if it's 0.0.0 (unversioned)
  const version = workspaceVersion && workspaceVersion !== '0.0.0' ? `@${workspaceVersion}` : '';
  console.log(`${workspaceName}${version} ${cwd}`);
  
  if (packages.length === 0) {
    return;
  }

  packages.forEach((pkg, index) => {
    const isLast = index === packages.length - 1;
    const treeChar = isLast ? '└──' : '├──';
    
    // Omit version if it's 0.0.0 (unversioned)
    const pkgVersion = pkg.version && pkg.version !== '0.0.0' ? `@${pkg.version}` : '';
    
    // Add dimmed status indicator if not synced
    let statusSuffix = '';
    if (pkg.state === 'partial') {
      statusSuffix = dim(` (partial ${pkg.existingFiles}/${pkg.totalFiles})`);
    } else if (pkg.state === 'missing') {
      statusSuffix = dim(' (missing)');
    }
    
    console.log(`${treeChar} ${pkg.name}${pkgVersion}${statusSuffix}`);
  });
}

function printDetailedView(pkg: ListPackageReport): void {
  // Omit version if it's 0.0.0 (unversioned)
  const version = pkg.version && pkg.version !== '0.0.0' ? `@${pkg.version}` : '';
  console.log(`${pkg.name}${version}`);
  
  // Status line
  if (pkg.state === 'partial') {
    console.log(`Status: ${pkg.state} (${pkg.existingFiles}/${pkg.totalFiles} files)`);
  } else {
    console.log(`Status: ${pkg.state}`);
  }
  
  console.log(`Source: ${pkg.path}`);
  
  // Show files or error
  if (pkg.state === 'missing') {
    console.log('Error: Source directory not found');
  } else if (pkg.fileList && pkg.fileList.length > 0) {
    console.log(`Files (${pkg.fileList.length}):`);
    for (const file of pkg.fileList) {
      console.log(`  ${file.source} → ${file.target}`);
    }
  }
}

async function listCommand(packageName?: string): Promise<CommandResult> {
  const cwd = process.cwd();
  logger.info(`Listing packages for directory: ${cwd}`);

  try {
    const result = await runListPipeline(packageName);
    const packages = result.data?.packages ?? [];

    // If specific package requested, show detailed view
    if (packageName) {
      if (packages.length === 0) {
        throw new ValidationError(`Package '${packageName}' not found in workspace index`);
      }
      printDetailedView(packages[0]);
      return { success: true, data: { packages } };
    }

    // Otherwise show tree view
    const manifestPath = getLocalPackageYmlPath(cwd);
    let workspaceName = 'Unnamed';
    let workspaceVersion: string | undefined;
    
    try {
      const manifest = await parsePackageYml(manifestPath);
      workspaceName = manifest.name || 'Unnamed';
      workspaceVersion = manifest.version;
    } catch (error) {
      logger.warn(`Failed to read workspace manifest: ${error}`);
    }

    printTreeView(workspaceName, workspaceVersion, packages, cwd);

    return { success: true, data: { packages } };
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
    .description('Show installed packages and files')
    .argument('[package]', 'Optional package name to show installed per package')
    .action(withErrorHandling(async (packageName?: string) => {
      await listCommand(packageName);
    }));
}
