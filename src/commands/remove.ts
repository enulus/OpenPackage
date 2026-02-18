import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runRemoveFromSourcePipeline, type RemoveFromSourceOptions } from '../core/remove/remove-from-source-pipeline.js';
import { resolveMutableSource } from '../core/source-resolution/resolve-mutable-source.js';
import { readWorkspaceIndex } from '../utils/workspace-index-yml.js';
import { getTreeConnector } from '../utils/formatters.js';
import { interactiveFileSelect } from '../utils/interactive-file-selector.js';
import { expandDirectorySelections, hasDirectorySelections, countSelectionTypes } from '../utils/expand-directory-selections.js';
import { interactivePackageSelect, resolvePackageSelection } from '../utils/interactive-package-selector.js';
import { createExecutionContext } from '../core/execution-context.js';
import { createInteractionPolicy, PromptTier } from '../core/interaction-policy.js';
import { setOutputMode, output, isInteractive } from '../utils/output.js';
import type { ExecutionContext } from '../types/execution-context.js';

export function setupRemoveCommand(program: Command): void {
  program
    .command('remove')
    .alias('rm')
    .argument('[path]', 'file or directory to remove. If omitted, shows interactive file selector.')
    .description('Remove files from a mutable package source or workspace package')
    .option('--from <package-name>', 'source package name (defaults to workspace package)')
    .option('--force', 'Skip confirmation prompts')
    .option('--dry-run', 'Preview what would be removed without actually deleting')
    .action(
      withErrorHandling(async (pathArg: string | undefined, options: RemoveFromSourceOptions & { from?: string }, command: Command) => {
        const cwd = process.cwd();
        const programOpts = command.parent?.opts() || {};

        const execContext = await createExecutionContext({
          global: false,
          cwd: programOpts.cwd,
        });

        const policy = createInteractionPolicy({
          interactive: !pathArg,
          force: options.force,
        });
        execContext.interactionPolicy = policy;

        // Set output mode: interactive (clack UI) when no path provided, plain console otherwise
        setOutputMode(!pathArg);

        // If no path argument provided, show interactive selector
        if (!pathArg) {
          if (!policy.canPrompt(PromptTier.OptionalMenu)) {
            throw new Error(
              '<path> argument is required in non-interactive mode.\n' +
              'Usage: opkg remove <path> [options]\n\n' +
              'Examples:\n' +
              '  opkg remove file.txt                        # Remove from workspace package\n' +
              '  opkg remove file.txt --from package-name    # Remove from specific package\n' +
              '  opkg remove                                 # Interactive mode (TTY only)'
            );
          }
          
          // Step 1: Select package (if not specified via --from)
          let selectedPackage: string | null = null;
          let packageDir: string;
          
          if (options.from) {
            // Package specified via --from option - resolve from workspace or global
            try {
              const source = await resolveMutableSource({ cwd, packageName: options.from });
              selectedPackage = source.packageName;
              packageDir = source.absolutePath;
            } catch (error) {
              throw new Error(error instanceof Error ? error.message : String(error));
            }
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
            message: `Select files or directories to remove from ${packageLabel}`,
            placeholder: 'Type to search...',
            includeDirs: true
          });
          
          // Handle cancellation or empty selection
          if (!selectedFiles || selectedFiles.length === 0) {
            return;
          }
          
          // Expand any directory selections to individual files
          let filesToProcess: string[];
          if (hasDirectorySelections(selectedFiles)) {
            const counts = countSelectionTypes(selectedFiles);
            output.info(`Expanding ${counts.dirs} director${counts.dirs === 1 ? 'y' : 'ies'} and ${counts.files} file${counts.files === 1 ? '' : 's'}...`);
            filesToProcess = await expandDirectorySelections(selectedFiles, packageDir);
            output.info(`Found ${filesToProcess.length} total file${filesToProcess.length === 1 ? '' : 's'} to remove`);
          } else {
            filesToProcess = selectedFiles;
          }
          
          // Step 3: Process each selected file sequentially
          for (let i = 0; i < filesToProcess.length; i++) {
            const file = filesToProcess[i];
            
            // Show progress for multiple files
            if (filesToProcess.length > 1) {
              output.message(`[${i + 1}/${filesToProcess.length}] Processing: ${file}`);
            }
            
            try {
              await processRemoveResource(selectedPackage ?? undefined, file, options, cwd, execContext);
            } catch (error) {
              output.error(`Failed to remove ${file}: ${error}`);
              // Continue with remaining files
            }
          }
          
          return;
        }
        
        // Process single path argument (existing behavior)
        await processRemoveResource(options.from, pathArg, options, cwd, execContext);
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
  cwd: string,
  execContext: ExecutionContext
): Promise<void> {
  const result = await runRemoveFromSourcePipeline(packageName, pathArg, { ...options, execContext });
  if (!result.success) {
    throw new Error(result.error || 'Remove operation failed');
  }
  
  // Provide helpful feedback (uses unified output: clack in interactive, plain console otherwise)
  if (result.data) {
    const { filesRemoved, sourcePath, packageName: resolvedName, removedPaths } = result.data;

    // Determine if this is a workspace root removal
    const isWorkspaceRoot = sourcePath.includes('.openpackage') && !sourcePath.includes('.openpackage/packages');

    if (options.dryRun) {
      if (isWorkspaceRoot) {
        output.success(`(dry-run) Would remove ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from workspace package`);
      } else {
        output.success(`(dry-run) Would remove ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from ${resolvedName}`);
      }
    } else {
      if (isWorkspaceRoot) {
        output.success(`Removed ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from workspace package`);
      } else {
        output.success(`Removed ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from ${resolvedName}`);
      }
    }

    if (removedPaths.length > 0) {
      const sortedPaths = [...removedPaths].sort((a, b) => a.localeCompare(b));
      if (isInteractive()) {
        const maxDisplay = 10;
        const displayPaths = sortedPaths.slice(0, maxDisplay);
        const more = sortedPaths.length > maxDisplay ? `\n... and ${sortedPaths.length - maxDisplay} more` : '';
        output.note(displayPaths.join('\n') + more, 'Removed files');
      } else {
        for (let i = 0; i < sortedPaths.length; i++) {
          const connector = getTreeConnector(i === sortedPaths.length - 1);
          output.message(`  ${connector}${sortedPaths[i]}`);
        }
      }
    }

    if (!options.dryRun && !isWorkspaceRoot) {
      const workspaceIndexRecord = await readWorkspaceIndex(cwd);
      const isInstalled = !!workspaceIndexRecord.index.packages[resolvedName];
      if (isInstalled) {
        output.message(`Run \`opkg install ${resolvedName}\` to sync.`);
      }
    }
  }
}
