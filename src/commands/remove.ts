import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runRemoveFromSourcePipeline, runRemoveFromSourcePipelineBatch, type RemoveFromSourceOptions } from '../core/remove/remove-from-source-pipeline.js';
import { resolveMutableSource } from '../core/source-resolution/resolve-mutable-source.js';
import { readWorkspaceIndex } from '../utils/workspace-index-yml.js';
import { formatPathForDisplay, getTreeConnector } from '../utils/formatters.js';
import { interactiveFileSelect } from '../utils/interactive-file-selector.js';
import { expandDirectorySelections, hasDirectorySelections } from '../utils/expand-directory-selections.js';
import { interactivePackageSelect, resolvePackageSelection } from '../utils/interactive-package-selector.js';
import { createExecutionContext } from '../core/execution-context.js';
import { buildWorkspacePackageContext } from '../utils/workspace-package-context.js';
import { UserCancellationError } from '../utils/errors.js';
import { createInteractionPolicy, PromptTier } from '../core/interaction-policy.js';
import { setOutputMode, output, isInteractive } from '../utils/output.js';
import type { ExecutionContext } from '../types/execution-context.js';

export function setupRemoveCommand(program: Command): void {
  program
    .command('remove')
    .alias('rm')
    .argument('[target]', 'file, directory, or dependency to remove. If omitted, shows interactive file selector.')
    .description('Remove files or dependencies from a mutable package source or workspace package')
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
              '  opkg remove file.txt                        # Remove file from workspace package\n' +
              '  opkg remove file.txt --from package-name    # Remove from specific package\n' +
              '  opkg remove essential-agent --from essentials  # Remove dependency from package\n' +
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
          
          // Show package/source before file selection
          const packageLabel = selectedPackage || 'workspace package';
          const displayPath = formatPathForDisplay(packageDir, cwd);
          output.step(`From: ${packageLabel} (${displayPath})`);
          output.connector();
          
          // Step 2: Select files from package
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
            filesToProcess = await expandDirectorySelections(selectedFiles, packageDir);
            output.info(`Found ${filesToProcess.length} total file${filesToProcess.length === 1 ? '' : 's'} to remove`);
          } else {
            filesToProcess = selectedFiles;
          }

          const resolvedName = selectedPackage ?? (await buildWorkspacePackageContext(cwd)).name;

          // Batch remove: one confirmation, one removal pass
          try {
            const result = await runRemoveFromSourcePipelineBatch(
              selectedPackage,
              packageDir,
              resolvedName,
              filesToProcess,
              { ...options, execContext }
            );
            if (!result.success) throw new Error(result.error || 'Remove operation failed');
            if (result.data) await handleRemoveResult(result.data, options, cwd, true);
          } catch (error) {
            if (error instanceof UserCancellationError) return;
            throw error;
          }

          return;
        }
        
        // Process single path argument (existing behavior)
        await processRemoveResource(options.from, pathArg, options, cwd, execContext);
      })
    );
}

/** Shared result handling for single-path and batch removal.
 * @param skipHeader - When true (interactive remove), header was already shown before selection
 */
async function handleRemoveResult(
  data: { filesRemoved: number; sourcePath: string; packageName: string; removedPaths: string[]; removalType?: string; removedDependency?: string },
  options: RemoveFromSourceOptions & { from?: string },
  cwd: string,
  skipHeader = false
): Promise<void> {
  const { filesRemoved, sourcePath, packageName: resolvedName, removedPaths, removalType, removedDependency } = data;
  const isWorkspaceRoot = sourcePath.includes('.openpackage') && !sourcePath.includes('.openpackage/packages');

  if (!skipHeader) {
    const pkgLabel = isWorkspaceRoot ? 'workspace package' : resolvedName;
    const displayPath = formatPathForDisplay(sourcePath, cwd);
    const header = `From: ${pkgLabel} (${displayPath})`;
    if (isInteractive()) output.info(header);
    else output.success(header);
  }

  if (removalType === 'dependency') {
    output.success(`Removed dependency ${removedDependency} from ${resolvedName}`);
  } else if (options.dryRun) {
    output.success(isWorkspaceRoot
      ? `(dry-run) Would remove ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from workspace package`
      : `(dry-run) Would remove ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from ${resolvedName}`);
  } else {
    output.success(isWorkspaceRoot
      ? `Removed ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from workspace package`
      : `Removed ${filesRemoved} file${filesRemoved !== 1 ? 's' : ''} from ${resolvedName}`);
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
        output.message(`  ${getTreeConnector(i === sortedPaths.length - 1)}${sortedPaths[i]}`);
      }
    }
  }

  if (!options.dryRun && !isWorkspaceRoot) {
    const workspaceIndexRecord = await readWorkspaceIndex(cwd);
    if (workspaceIndexRecord.index.packages[resolvedName]) {
      output.message(`Run \`opkg install ${resolvedName}\` to sync.`);
    }
  }
}

async function processRemoveResource(
  packageName: string | undefined,
  pathArg: string,
  options: RemoveFromSourceOptions & { from?: string },
  cwd: string,
  execContext: ExecutionContext
): Promise<void> {
  let headerShown = false;
  const result = await runRemoveFromSourcePipeline(packageName, pathArg, {
    ...options,
    execContext,
    beforeConfirm: (info) => {
      const pkgLabel = info.packageName;
      const displayPath = formatPathForDisplay(info.sourcePath, cwd);
      output.success(`From: ${pkgLabel} (${displayPath})`);
      headerShown = true;
    }
  });
  if (!result.success) throw new Error(result.error || 'Remove operation failed');
  if (result.data) await handleRemoveResult(result.data, options, cwd, headerShown);
}
