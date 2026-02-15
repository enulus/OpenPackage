import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runRemoveFromSourcePipeline, type RemoveFromSourceOptions } from '../core/remove/remove-from-source-pipeline.js';
import { readWorkspaceIndex } from '../utils/workspace-index-yml.js';
import { formatPathForDisplay } from '../utils/formatters.js';

export function setupRemoveCommand(program: Command): void {
  program
    .command('remove')
    .alias('rm')
    .argument('<path>', 'file, directory, or resource name to remove')
    .description('Remove files from a mutable package source or workspace package')
    .option('--from <package-name>', 'source package name (defaults to workspace package)')
    .option('--force', 'Skip confirmation prompts')
    .option('--dry-run', 'Preview what would be removed without actually deleting')
    .action(
      withErrorHandling(async (pathArg: string, options: RemoveFromSourceOptions & { from?: string }) => {
        const packageName = options.from;
        const result = await runRemoveFromSourcePipeline(packageName, pathArg, options);
        if (!result.success) {
          throw new Error(result.error || 'Remove operation failed');
        }
        
        // Provide helpful feedback
        if (result.data) {
          const cwd = process.cwd();
          const { filesRemoved, sourcePath, sourceType, packageName: resolvedName, removedPaths } = result.data;
          
          // Format the path for display using unified formatter
          const displayPath = formatPathForDisplay(sourcePath, cwd);
          
          // Determine if this is a workspace root removal
          const isWorkspaceRoot = displayPath.includes('.openpackage') && !displayPath.includes('.openpackage/packages');
          
          if (options.dryRun) {
            if (isWorkspaceRoot) {
              console.log(`\n(dry-run) Would remove ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from workspace package`);
            } else {
              console.log(`\n(dry-run) Would remove ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from ${resolvedName}`);
            }
          } else {
            if (isWorkspaceRoot) {
              console.log(`\n✓ Removed ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from workspace package`);
            } else {
              console.log(`\n✓ Removed ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from ${resolvedName}`);
            }
          }
          
          console.log(`  Path: ${displayPath}`);
          console.log(`  Type: ${sourceType} package`);
          
          // Show removed files (limited display)
          if (removedPaths.length > 0) {
            const maxDisplay = 10;
            console.log(`\nFiles ${options.dryRun ? 'to be removed' : 'removed'}:`);
            
            const displayPaths = removedPaths.slice(0, maxDisplay);
            for (const path of displayPaths) {
              console.log(`  - ${path}`);
            }
            
            if (removedPaths.length > maxDisplay) {
              console.log(`  ... and ${removedPaths.length - maxDisplay} more`);
            }
          }
          
          if (!options.dryRun && !isWorkspaceRoot) {
            // Check if package is installed in workspace
            const workspaceIndexRecord = await readWorkspaceIndex(cwd);
            const isInstalled = !!workspaceIndexRecord.index.packages[resolvedName];
            
            if (isInstalled) {
              console.log(`\n💡 Deletions not synced to workspace.`);
              console.log(`   To sync deletions, run:`);
              console.log(`     opkg install ${resolvedName}`);
            } else {
              console.log(`\n💡 Package not installed in workspace.`);
              console.log(`   If you install this package later, the removed files won't be included.`);
            }
          }
        }
      })
    );
}
