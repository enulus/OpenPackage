import { Command } from 'commander';

import { UninstallOptions } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { runUninstallPipeline } from '../core/uninstall/uninstall-pipeline.js';
import { formatPathForDisplay } from '../utils/formatters.js';

async function uninstallPackageCommand(
  packageName: string,
  options: UninstallOptions
) {
  // No validation - let the pipeline normalize and look up the package
  const result = await runUninstallPipeline(packageName, options);
  if (!result.success) {
    throw new ValidationError(result.error || 'Uninstall failed');
  }

  console.log(`✓ Uninstalled ${packageName}`);
  
  const removedFiles = result.data?.removedFiles ?? [];
  const rootFilesUpdated = result.data?.rootFilesUpdated ?? [];
  
  if (removedFiles.length > 0) {
    console.log(`✓ Removed files: ${removedFiles.length}`);
    const sortedFiles = [...removedFiles].sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles) {
      console.log(`   ├── ${formatPathForDisplay(file)}`);
    }
  }
  
  if (rootFilesUpdated.length > 0) {
    console.log(`✓ Updated root files: ${rootFilesUpdated.length}`);
    const sortedFiles = [...rootFilesUpdated].sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles) {
      console.log(`   ├── ${formatPathForDisplay(file)} (updated)`);
    }
  }
}

export function setupUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .alias('un')
    .description('Remove installed package files')
    .argument('<package-name>', 'name of the package to uninstall')
    .option('--dry-run', 'preview changes without applying them')
    .action(withErrorHandling(async (packageName: string, options: UninstallOptions) => {
      await uninstallPackageCommand(packageName, options);
    }));
}
