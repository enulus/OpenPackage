import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runAddToSourcePipeline, type AddToSourceResult } from '../core/add/add-to-source-pipeline.js';
import { readWorkspaceIndex } from '../utils/workspace-index-yml.js';
import { formatPathForDisplay } from '../utils/formatters.js';

/**
 * Display add operation results in install-style format
 */
async function displayAddResults(data: AddToSourceResult): Promise<void> {
  const cwd = process.cwd();
  const { filesAdded, packageName: resolvedName, addedFilePaths, isWorkspaceRoot } = data;
  
  // Main success message
  if (isWorkspaceRoot) {
    console.log(`✓ Added to workspace package`);
  } else {
    console.log(`✓ Added to ${resolvedName}`);
  }
  
  // Display added files in install-style format
  if (addedFilePaths && addedFilePaths.length > 0) {
    console.log(`✓ Added files: ${addedFilePaths.length}`);
    const sortedFiles = [...addedFilePaths].sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles) {
      console.log(`   ├── ${formatPathForDisplay(file, cwd)}`);
    }
  } else {
    console.log(`✓ Added files: ${filesAdded}`);
  }
  
  // Show install hint only for non-workspace-root adds
  if (!isWorkspaceRoot) {
    try {
      const workspaceIndexRecord = await readWorkspaceIndex(cwd);
      const isInstalled = !!workspaceIndexRecord.index.packages[resolvedName];
      const label = isInstalled ? 'Changes not synced to workspace.' : 'Package not installed in workspace.';
      console.log(`\n💡 ${label}`);
      console.log(`   To ${isInstalled ? 'sync changes' : 'install and sync'}, run:`);
      console.log(`     opkg install ${resolvedName}`);
    } catch {
      // Ignore errors reading workspace index
    }
  }
}

export function setupAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<path>', 'file or directory to add')
    .description('Add files to a mutable package source or workspace package')
    .option('--to <package-name>', 'target package name (defaults to workspace package)')
    .option('--platform-specific', 'Save platform-specific variants for platform subdir inputs')
    .action(
      withErrorHandling(async (pathArg: string, options) => {
        const packageName = options.to;
        const result = await runAddToSourcePipeline(packageName, pathArg, options);
        if (!result.success) {
          throw new Error(result.error || 'Add operation failed');
        }
        
        if (result.data) {
          await displayAddResults(result.data);
        }
      })
    );
}
