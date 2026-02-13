import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runAddToSourcePipeline, type AddToSourceResult } from '../core/add/add-to-source-pipeline.js';
import { classifyAddInput, type AddInputClassification } from '../core/add/add-input-classifier.js';
import { runAddDependencyFlow, type AddDependencyResult } from '../core/add/add-dependency-flow.js';
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

export function setupAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<resource-spec>',
      'resource to add (package[@version], gh@owner/repo, https://github.com/owner/repo, /path/to/local)')
    .description('Add a dependency to openpackage.yml or copy files to a package')
    .option('--to <package-name>', 'target package (for dependency: which manifest; for copy: which package source)')
    .option('--dev', 'add to dev-dependencies instead of dependencies')
    .option('--copy', 'force copy mode (copy files instead of recording dependency)')
    .option('--platform-specific', 'save platform-specific variants for platform subdir inputs')
    .action(
      withErrorHandling(async (resourceSpec: string, options) => {
        const cwd = process.cwd();
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
      })
    );
}
