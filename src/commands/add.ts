import { Command } from 'commander';
import { join, relative } from 'path';

import type { ExecutionContext } from '../types/execution-context.js';

import { withErrorHandling } from '../utils/errors.js';
import { runAddToSourcePipeline, type AddToSourceResult } from '../core/add/add-to-source-pipeline.js';
import { classifyAddInput, type AddInputClassification } from '../core/add/add-input-classifier.js';
import { runAddDependencyFlow, type AddDependencyResult } from '../core/add/add-dependency-flow.js';
import { formatPathForDisplay, getTreeConnector } from '../utils/formatters.js';
import { interactiveFileSelect } from '../utils/interactive-file-selector.js';
import { expandDirectorySelections, hasDirectorySelections, countSelectionTypes } from '../utils/expand-directory-selections.js';
import { createExecutionContext } from '../core/execution-context.js';
import { createInteractionPolicy, PromptTier } from '../core/interaction-policy.js';
import { setOutputMode, output, isInteractive } from '../utils/output.js';

/**
 * Display add operation results.
 * Interactive: flat list in clack note (like uninstall -i).
 * Non-interactive: tree view with connectors.
 */
function displayAddResults(data: AddToSourceResult): void {
  const { filesAdded, packageName: resolvedName, addedFilePaths, isWorkspaceRoot, sourcePath } = data;
  const target = isWorkspaceRoot ? 'workspace package' : resolvedName;

  if (filesAdded > 0) {
    const count = filesAdded === 1 ? '1 file' : `${filesAdded} files`;
    output.success(`Added ${count} to ${target}`);
    const sortedFiles = [...(addedFilePaths || [])].sort((a, b) => a.localeCompare(b));
    const relPaths = sortedFiles.map((f) => relative(sourcePath, f).replace(/\\/g, '/'));

    if (isInteractive()) {
      const maxDisplay = 10;
      const displayPaths = relPaths.slice(0, maxDisplay);
      const more = relPaths.length > maxDisplay ? `\n... and ${relPaths.length - maxDisplay} more` : '';
      output.note(displayPaths.join('\n') + more, 'Added files');
    } else {
      for (let i = 0; i < relPaths.length; i++) {
        const connector = getTreeConnector(i === relPaths.length - 1);
        output.message(`  ${connector}${relPaths[i]}`);
      }
    }
  } else {
    output.success(`No new files added to ${target}`);
  }
}

function displayDependencyResult(result: AddDependencyResult, classification: AddInputClassification): void {
  // Show auto-detection hint for local paths
  if (result.wasAutoDetected) {
    output.info(`Detected package at ${classification.localPath} — adding as dependency.`);
    output.message('To copy files instead, use --copy.');
  }

  const versionSuffix = classification.version ? `@${classification.version}` : '';
  output.success(`Added ${result.packageName}${versionSuffix} to ${result.section}`);
  output.message(`in ${formatPathForDisplay(result.targetManifest, process.cwd())}`);
}

/**
 * Process a single resource spec through the add pipeline
 */
async function processAddResource(
  resourceSpec: string,
  options: any,
  cwd: string,
  execContext: ExecutionContext
): Promise<void> {
  const classification = await classifyAddInput(resourceSpec, cwd, {
    copy: options.copy,
    dev: options.dev,
  });

  if (classification.mode === 'dependency') {
    if (options.platformSpecific) {
      // --platform-specific is only valid for copy mode
      throw new Error('--platform-specific can only be used with --copy or when adding files');
    }
    const result = await runAddDependencyFlow(classification, {
      dev: options.dev,
      to: options.to,
    });
    displayDependencyResult(result, classification);
  } else if (classification.mode === 'workspace-resource') {
    if (options.dev) {
      throw new Error('--dev can only be used when adding a dependency, not when copying files');
    }
    const resource = classification.resolvedResource!;
    const ctx = await createExecutionContext({
      global: resource.scope === 'global',
    });
    const absPath = resource.sourcePath || join(ctx.targetDir, resource.targetFiles[0]);

    const packageName = options.to;
    const result = await runAddToSourcePipeline(packageName, absPath, { ...options, execContext });
    if (!result.success) {
      throw new Error(result.error || 'Add operation failed');
    }
    if (result.data) {
      output.info(`Resolved "${resourceSpec}" from installed workspace resources.`);
      displayAddResults(result.data);
    }
  } else {
    if (options.dev) {
      throw new Error('--dev can only be used when adding a dependency, not when copying files');
    }
    const packageName = options.to;
    const result = await runAddToSourcePipeline(packageName, classification.copySourcePath!, { ...options, execContext });
    if (!result.success) {
      throw new Error(result.error || 'Add operation failed');
    }
    if (result.data) {
      displayAddResults(result.data);
    }
  }
}

export function setupAddCommand(program: Command): void {
  program
    .command('add')
    .argument('[resource-spec]',
      'resource to add (package[@version], gh@owner/repo, https://github.com/owner/repo, or /path/to/file). If omitted, shows interactive file selector.')
    .description('Add a dependency to openpackage.yml or copy files to a package')
    .option('--to <package-name>', 'target package (for dependency: which manifest; for copy: which package source)')
    .option('--dev', 'add to dev-dependencies instead of dependencies')
    .option('--copy', 'force copy mode (copy files instead of recording dependency)')
    .option('--platform-specific', 'save platform-specific variants for platform subdir inputs')
    .option('--force', 'overwrite existing files without prompting')
    .action(
      withErrorHandling(async (resourceSpec: string | undefined, options, command: Command) => {
        const cwd = process.cwd();
        const programOpts = command.parent?.opts() || {};

        const execContext = await createExecutionContext({
          global: false,
          cwd: programOpts.cwd,
        });

        const policy = createInteractionPolicy({
          interactive: !resourceSpec,
          force: options.force,
        });
        execContext.interactionPolicy = policy;

        // Set output mode: interactive (clack UI) when no resource-spec, plain console otherwise
        setOutputMode(!resourceSpec);

        // If no resource spec provided, show interactive file selector
        if (!resourceSpec) {
          if (!policy.canPrompt(PromptTier.OptionalMenu)) {
            throw new Error(
              '<resource-spec> argument is required in non-interactive mode.\n' +
              'Usage: opkg add <resource-spec> [options]\n\n' +
              'Examples:\n' +
              '  opkg add ./path/to/file.txt              # Add local file\n' +
              '  opkg add gh@owner/repo                   # Add from GitHub\n' +
              '  opkg add package@version                 # Add package dependency'
            );
          }

          // Show interactive file selector
          const selectedFiles = await interactiveFileSelect({ cwd, includeDirs: true });
          
          // Handle cancellation or empty selection
          if (!selectedFiles || selectedFiles.length === 0) {
            return;
          }
          
          // Expand any directory selections to individual files
          let filesToProcess: string[];
          if (hasDirectorySelections(selectedFiles)) {
            const counts = countSelectionTypes(selectedFiles);
            output.info(`Expanding ${counts.dirs} director${counts.dirs === 1 ? 'y' : 'ies'} and ${counts.files} file${counts.files === 1 ? '' : 's'}...`);
            filesToProcess = await expandDirectorySelections(selectedFiles, cwd);
            output.info(`Found ${filesToProcess.length} total file${filesToProcess.length === 1 ? '' : 's'} to add`);
          } else {
            filesToProcess = selectedFiles;
          }
          
          // Process each selected file sequentially
          for (let i = 0; i < filesToProcess.length; i++) {
            const file = filesToProcess[i];
            const absPath = join(cwd, file);
            
            // Show progress for multiple files
            if (filesToProcess.length > 1) {
              output.message(`[${i + 1}/${filesToProcess.length}] Processing: ${file}`);
            }
            
            try {
              await processAddResource(absPath, options, cwd, execContext);
            } catch (error) {
              output.error(`Failed to add ${file}: ${error}`);
              // Continue with remaining files
            }
          }
          
          return;
        }
        
        // Process single resource spec (existing behavior)
        await processAddResource(resourceSpec, options, cwd, execContext);
      })
    );
}
