import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runAddToSourcePipeline, type AddToSourceResult } from '../core/add/add-to-source-pipeline.js';
import { classifyAddInput, type AddInputClassification } from '../core/add/add-input-classifier.js';
import { runAddDependencyFlow, type AddDependencyResult } from '../core/add/add-dependency-flow.js';
import { readWorkspaceIndex } from '../utils/workspace-index-yml.js';
import { formatPathForDisplay } from '../utils/formatters.js';
import { canPrompt } from '../utils/file-scanner.js';
import { interactiveFileSelect } from '../utils/interactive-file-selector.js';
import { join } from 'path';

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

function displayDependencyResult(result: AddDependencyResult, classification: AddInputClassification): void {
  // Show auto-detection hint for local paths
  if (result.wasAutoDetected) {
    console.log(`💡 Detected package at ${classification.localPath} — adding as dependency.`);
    console.log(`   To copy files instead, use --copy.\n`);
  }

  const versionSuffix = classification.version ? `@${classification.version}` : '';
  console.log(`✓ Added ${result.packageName}${versionSuffix} to ${result.section}`);
  console.log(`  in ${formatPathForDisplay(result.targetManifest, process.cwd())}`);

  // Show install hint
  console.log(`\n💡 To install, run:`);
  console.log(`     opkg install`);
}

/**
 * Process a single resource spec through the add pipeline
 */
async function processAddResource(
  resourceSpec: string,
  options: any,
  cwd: string
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

    const { createExecutionContext } = await import('../core/execution-context.js');
    const path = await import('path');
    const ctx = await createExecutionContext({
      global: resource.scope === 'global',
    });

    const absPath = resource.sourcePath || path.default.join(ctx.targetDir, resource.targetFiles[0]);

    const packageName = options.to;
    const result = await runAddToSourcePipeline(packageName, absPath, options);
    if (!result.success) {
      throw new Error(result.error || 'Add operation failed');
    }
    if (result.data) {
      console.log(`💡 Resolved "${resourceSpec}" from installed workspace resources.`);
      await displayAddResults(result.data);
    }
  } else {
    if (options.dev) {
      throw new Error('--dev can only be used when adding a dependency, not when copying files');
    }
    const packageName = options.to;
    const result = await runAddToSourcePipeline(packageName, classification.copySourcePath!, options);
    if (!result.success) {
      throw new Error(result.error || 'Add operation failed');
    }
    if (result.data) {
      await displayAddResults(result.data);
    }
  }
}

export function setupAddCommand(program: Command): void {
  program
    .command('add')
    .argument('[resource-spec]',
      'resource to add (package[@version], gh@owner/repo, https://github.com/owner/repo, /path/to/local, or installed resource name). If omitted, shows interactive file selector.')
    .description('Add a dependency to openpackage.yml or copy files to a package')
    .option('--to <package-name>', 'target package (for dependency: which manifest; for copy: which package source)')
    .option('--dev', 'add to dev-dependencies instead of dependencies')
    .option('--copy', 'force copy mode (copy files instead of recording dependency)')
    .option('--platform-specific', 'save platform-specific variants for platform subdir inputs')
    .action(
      withErrorHandling(async (resourceSpec: string | undefined, options) => {
        const cwd = process.cwd();
        
        // If no resource spec provided, show interactive file selector
        if (!resourceSpec) {
          // Check if we're in an interactive terminal
          if (!canPrompt()) {
            throw new Error(
              '<resource-spec> argument is required in non-interactive mode.\n' +
              'Usage: opkg add <resource-spec> [options]\n\n' +
              'Examples:\n' +
              '  opkg add cursor-rules                    # Add from workspace resources\n' +
              '  opkg add ./path/to/file.txt              # Add local file\n' +
              '  opkg add gh@owner/repo                   # Add from GitHub\n' +
              '  opkg add package@version                 # Add package dependency'
            );
          }
          
          // Show interactive file selector
          const selectedFiles = await interactiveFileSelect({ cwd });
          
          // Handle cancellation or empty selection
          if (!selectedFiles || selectedFiles.length === 0) {
            return;
          }
          
          // Process each selected file sequentially
          console.log(); // Add spacing before results
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            const absPath = join(cwd, file);
            
            // Show progress for multiple files
            if (selectedFiles.length > 1) {
              console.log(`\n[${i + 1}/${selectedFiles.length}] Processing: ${file}`);
            }
            
            try {
              await processAddResource(absPath, options, cwd);
            } catch (error) {
              console.error(`✗ Failed to add ${file}: ${error}`);
              // Continue with remaining files
            }
          }
          
          return;
        }
        
        // Process single resource spec (existing behavior)
        await processAddResource(resourceSpec, options, cwd);
      })
    );
}
