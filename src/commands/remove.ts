import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runRemoveFromSourcePipeline, type RemoveFromSourceOptions } from '../core/remove/remove-from-source-pipeline.js';
import { readWorkspaceIndex } from '../utils/workspace-index-yml.js';
import { formatPathForDisplay } from '../utils/formatters.js';

export function setupRemoveCommand(program: Command): void {
  program
    .command('remove')
    .alias('rm')
    .argument('<package-name>', 'package name')
    .argument('<path>', 'file or directory to remove from package')
    .description(
      'Remove files from a mutable package source (workspace or global packages).\n\n' +
      'This command modifies the package source only. To sync deletions to your workspace:\n' +
      '  1. Ensure package is installed: opkg install <package-name>\n' +
      '  2. Apply the changes: opkg apply <package-name>\n' +
      'Or use --apply flag to do both (requires package to be installed in current workspace).\n\n' +
      'Usage examples:\n' +
      '  opkg remove my-package commands/deprecated.md\n' +
      '  opkg remove my-package rules/old/\n' +
      '  opkg remove my-package commands/test.md --apply\n\n' +
      'The remove command searches for mutable packages in:\n' +
      '  - Workspace packages: ./.openpackage/packages/\n' +
      '  - Global packages: ~/.openpackage/packages/\n\n' +
      'Registry packages are immutable and cannot be modified via remove.'
    )
    .option('--apply', 'Apply changes to workspace immediately (requires package to be installed)')
    .option('--force', 'Skip confirmation prompts')
    .option('--dry-run', 'Preview what would be removed without actually deleting')
    .action(
      withErrorHandling(async (packageName: string | undefined, pathArg: string | undefined, options: RemoveFromSourceOptions) => {
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
          
          if (options.dryRun) {
            console.log(`\n(dry-run) Would remove ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from ${resolvedName}`);
          } else {
            console.log(`\n✓ Removed ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from ${resolvedName}`);
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
          
          if (!options.apply && !options.dryRun) {
            // Check if package is installed in workspace
            const workspaceIndexRecord = await readWorkspaceIndex(cwd);
            const isInstalled = !!workspaceIndexRecord.index.packages[resolvedName];
            
            if (isInstalled) {
              console.log(`\n💡 Deletions not synced to workspace.`);
              console.log(`   To sync deletions, run:`);
              console.log(`     opkg apply ${resolvedName}`);
            } else {
              console.log(`\n💡 Package not installed in workspace.`);
              console.log(`   If you install this package later, the removed files won't be included.`);
            }
          }
        }
      })
    );
}
