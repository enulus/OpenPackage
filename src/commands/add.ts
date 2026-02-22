import type { Command } from 'commander';
import { join, relative, resolve } from 'path';

import type { ExecutionContext } from '../types/execution-context.js';

import { runAddToSourcePipeline, runAddToSourcePipelineBatch, type AddToSourceResult } from '../core/add/add-to-source-pipeline.js';
import { classifyAddInput, type AddInputClassification } from '../core/add/add-input-classifier.js';
import { runAddDependencyFlow, type AddDependencyResult } from '../core/add/add-dependency-flow.js';
import { formatPathForDisplay, getTreeConnector } from '../utils/formatters.js';
import { interactiveFileSelect } from '../utils/interactive-file-selector.js';
import { expandDirectorySelections, hasDirectorySelections } from '../utils/expand-directory-selections.js';
import { createExecutionContext } from '../core/execution-context.js';
import { resolveMutableSource } from '../core/source-resolution/resolve-mutable-source.js';
import { buildWorkspacePackageContext } from '../utils/workspace-package-context.js';
import { createInteractionPolicy, PromptTier } from '../core/interaction-policy.js';
import { setOutputMode, output, isInteractive } from '../utils/output.js';
import { exists } from '../utils/fs.js';

/**
 * Display add operation results.
 * Interactive: flat list in clack note (like uninstall -i).
 * Non-interactive: tree view with connectors.
 * @param skipHeader - When true (interactive add), header was already shown before selection
 */
function displayAddResults(data: AddToSourceResult, skipHeader = false): void {
  const { filesAdded, packageName: resolvedName, addedFilePaths, isWorkspaceRoot, sourcePath } = data;
  const target = isWorkspaceRoot ? 'workspace package' : resolvedName;

  if (!skipHeader) {
    const pkgLabel = isWorkspaceRoot ? 'workspace package' : resolvedName;
    const displayPath = formatPathForDisplay(sourcePath, process.cwd());
    const header = `To: ${pkgLabel} (${displayPath})`;
    if (isInteractive()) output.info(header);
    else output.success(header);
  }

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
  const displayPath = formatPathForDisplay(result.targetManifest, process.cwd());
  const header = `To: ${result.packageName} (${displayPath})`;
  if (isInteractive()) output.info(header);
  else output.success(header);

  // Show auto-detection hint for local paths
  if (result.wasAutoDetected) {
    output.info(`Detected package at ${classification.localPath} — adding as dependency.`);
    output.message('To copy files instead, use --copy.');
  }

  const versionSuffix = classification.version ? `@${classification.version}` : '';
  output.success(`Added ${result.packageName}${versionSuffix} to ${result.section}`);
  output.message(`in ${formatPathForDisplay(result.targetManifest, process.cwd())}`);
}

/** Check if input looks like a bare name (could be registry or local path) */
function isBareNameInput(input: string): boolean {
  return (
    !input.startsWith('./') &&
    !input.startsWith('../') &&
    !input.startsWith('/') &&
    !input.startsWith('~') &&
    !input.endsWith('/')
  );
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
    try {
      const result = await runAddDependencyFlow(classification, {
        dev: options.dev,
        to: options.to,
      });
      displayDependencyResult(result, classification);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isBareNameInput(resourceSpec)) {
        const localPath = resolve(cwd, resourceSpec);
        if (await exists(localPath)) {
          throw new Error(
            `${msg}\n\nA local path './${resourceSpec}' exists — did you mean:\n  opkg add ./${resourceSpec}`
          );
        }
      }
      throw error;
    }
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

export async function setupAddCommand(args: any[]): Promise<void> {
  const [resource, options, command] = args as [string | undefined, any, Command];
  const cwd = process.cwd();
  const programOpts = command.parent?.opts() || {};

  const execContext = await createExecutionContext({
    global: false,
    cwd: programOpts.cwd,
  });

  const policy = createInteractionPolicy({
    interactive: !resource,
    force: options.force,
  });
  execContext.interactionPolicy = policy;

  // Set output mode: interactive (clack UI) when no resource, plain console otherwise
  setOutputMode(!resource);

  // If no resource provided, show interactive file selector
  if (!resource) {
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

    // Resolve target package and show header before file selection
    let pkgLabel: string;
    let sourcePath: string;
    if (options.to) {
      const source = await resolveMutableSource({ cwd, packageName: options.to });
      pkgLabel = source.packageName;
      sourcePath = source.absolutePath;
    } else {
      const context = await buildWorkspacePackageContext(cwd);
      pkgLabel = 'workspace package';
      sourcePath = context.packageRootDir;
    }
    const displayPath = formatPathForDisplay(sourcePath, cwd);
    output.step(`To: ${pkgLabel} (${displayPath})`);
    output.connector();

    // Show interactive file selector
    const selectedFiles = await interactiveFileSelect({ cwd, includeDirs: true });
    
    // Handle cancellation or empty selection
    if (!selectedFiles || selectedFiles.length === 0) {
      return;
    }
    
    // Expand any directory selections to individual files
    let filesToProcess: string[];
    if (hasDirectorySelections(selectedFiles)) {
      filesToProcess = await expandDirectorySelections(selectedFiles, cwd);
      output.info(`Found ${filesToProcess.length} total file${filesToProcess.length === 1 ? '' : 's'} to add`);
    } else {
      filesToProcess = selectedFiles;
    }

    const absPaths = filesToProcess.map((f) => join(cwd, f));
    const result = await runAddToSourcePipelineBatch(options.to, absPaths, cwd, { ...options, execContext });
    if (!result.success) throw new Error(result.error || 'Add operation failed');
    if (result.data) displayAddResults(result.data, true);

    return;
  }
  
  // Process single resource (existing behavior)
  await processAddResource(resource, options, cwd, execContext);
}
