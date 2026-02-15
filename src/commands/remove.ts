import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runRemoveFromSourcePipeline, type RemoveFromSourceOptions } from '../core/remove/remove-from-source-pipeline.js';
import { readWorkspaceIndex } from '../utils/workspace-index-yml.js';
import { formatPathForDisplay } from '../utils/formatters.js';
import { canPrompt } from '../utils/file-scanner.js';
import { interactiveFileSelect } from '../utils/interactive-file-selector.js';
import { interactivePackageSelect, resolvePackageSelection, WORKSPACE_PACKAGE } from '../utils/interactive-package-selector.js';

export function setupRemoveCommand(program: Command): void {
  program
    .command('remove')
    .alias('rm')
    .argument('[path]', 'file, directory, or resource name to remove. If omitted, shows interactive file selector.')
    .description('Remove files from a mutable package source or workspace package')
    .option('--from <package-name>', 'source package name (defaults to workspace package)')
    .option('--force', 'Skip confirmation prompts')
    .option('--dry-run', 'Preview what would be removed without actually deleting')
    .action(
      withErrorHandling(async (pathArg: string | undefined, options: RemoveFromSourceOptions & { from?: string }) => {
        const cwd = process.cwd();
        
        // If no path argument provided, show interactive selector
        if (!pathArg) {
          // Check if we're in an interactive terminal
          if (!canPrompt()) {
            throw new Error(
              '<path> argument is required in non-interactive mode.\n' +
              'Usage: opkg remove <path> [options]\n\n' +
              'Examples:\n' +
              '  opkg remove file.txt                        # Remove from workspace package\n' +
              '  opkg remove file.txt --from package-name    # Remove from specific package\n' +
              '  opkg remove resource-name                   # Remove by resource name\n' +
              '  opkg remove                                 # Interactive mode (TTY only)'
            );
          }
          
          // Step 1: Select package (if not specified via --from)
          let selectedPackage: string | null = null;
          let packageDir: string;
          
          if (options.from) {
            // Package specified via --from option
            selectedPackage = options.from;
            // Get package directory (will be validated later by pipeline)
            const { getLocalPackageDir } = await import('../utils/paths.js');
            packageDir = getLocalPackageDir(cwd, options.from);
          } else {
            // Show interactive package selector
            const selection = await interactivePackageSelect({
              cwd,
              message: 'Select package to remove files from',
              allowWorkspace: true
            });
            
            if (!selection) {
              return;
            }
            
            const resolved = resolvePackageSelection(cwd, selection);
            if (!resolved) {
              return;
            }
            
            selectedPackage = resolved.packageName;
            packageDir = resolved.packageDir;
          }
          
          // Step 2: Select files from package
          const packageLabel = selectedPackage || 'workspace package';
          const selectedFiles = await interactiveFileSelect({
            cwd,
            basePath: packageDir,
            message: `Select files to remove from ${packageLabel}`,
            placeholder: 'Type to search files...'
          });
          
          // Handle cancellation or empty selection
          if (!selectedFiles || selectedFiles.length === 0) {
            return;
          }
          
          // Step 3: Process each selected file sequentially
          console.log(); // Add spacing before results
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            
            // Show progress for multiple files
            if (selectedFiles.length > 1) {
              console.log(`\n[${i + 1}/${selectedFiles.length}] Processing: ${file}`);
            }
            
            try {
              await processRemoveResource(selectedPackage ?? undefined, file, options, cwd);
            } catch (error) {
              console.error(`✗ Failed to remove ${file}: ${error}`);
              // Continue with remaining files
            }
          }
          
          return;
        }
        
        // Process single path argument (existing behavior)
        await processRemoveResource(options.from, pathArg, options, cwd);
      })
    );
}

/**
 * Process a single resource removal through the remove pipeline
 */
async function processRemoveResource(
  packageName: string | undefined,
  pathArg: string,
  options: RemoveFromSourceOptions & { from?: string },
  cwd: string
): Promise<void> {
  const result = await runRemoveFromSourcePipeline(packageName, pathArg, options);
  if (!result.success) {
    throw new Error(result.error || 'Remove operation failed');
  }
  
  // Provide helpful feedback
  if (result.data) {
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
}
