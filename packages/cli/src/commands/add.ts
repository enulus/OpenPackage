/**
 * Add Command (CLI layer)
 *
 * Thin shell over core/add/ pipelines.
 * Handles CLI arg parsing, interactive file selection, and display formatting.
 */

import type { Command } from 'commander';
import { join, relative } from 'path';

import { runAddToSourcePipelineBatch, type AddToSourceResult } from '@opkg/core/core/add/add-to-source-pipeline.js';
import { processAddResource, type AddResourceResult } from '@opkg/core/core/add/add-orchestrator.js';
import { formatPathForDisplay, getTreeConnector } from '@opkg/core/utils/formatters.js';
import { interactiveFileSelect } from '../utils/interactive-file-selector.js';
import { expandDirectorySelections, hasDirectorySelections } from '@opkg/core/utils/expand-directory-selections.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveMutableSource } from '@opkg/core/core/source-resolution/resolve-mutable-source.js';
import { buildWorkspacePackageContext } from '@opkg/core/utils/workspace-package-context.js';
import { createInteractionPolicy, PromptTier } from '@opkg/core/core/interaction-policy.js';
import { resolveOutput } from '@opkg/core/core/ports/resolve.js';

// ---------------------------------------------------------------------------
// Display helpers (CLI-specific)
// ---------------------------------------------------------------------------

function displayAddResults(data: AddToSourceResult, out: ReturnType<typeof resolveOutput>, interactive: boolean, skipHeader = false): void {
  const { filesAdded, packageName: resolvedName, addedFilePaths, isWorkspaceRoot, sourcePath } = data;
  const target = isWorkspaceRoot ? 'workspace package' : resolvedName;

  if (!skipHeader) {
    const pkgLabel = isWorkspaceRoot ? 'workspace package' : resolvedName;
    const displayPath = formatPathForDisplay(sourcePath, process.cwd());
    const header = `To: ${pkgLabel} (${displayPath})`;
    if (interactive) out.info(header);
    else out.success(header);
  }

  if (filesAdded > 0) {
    const count = filesAdded === 1 ? '1 file' : `${filesAdded} files`;
    out.success(`Added ${count} to ${target}`);
    const sortedFiles = [...(addedFilePaths || [])].sort((a, b) => a.localeCompare(b));
    const relPaths = sortedFiles.map((f) => relative(sourcePath, f).replace(/\\/g, '/'));

    if (interactive) {
      const maxDisplay = 10;
      const displayPaths = relPaths.slice(0, maxDisplay);
      const more = relPaths.length > maxDisplay ? `\n... and ${relPaths.length - maxDisplay} more` : '';
      out.note(displayPaths.join('\n') + more, 'Added files');
    } else {
      for (let i = 0; i < relPaths.length; i++) {
        const connector = getTreeConnector(i === relPaths.length - 1);
        out.message(`  ${connector}${relPaths[i]}`);
      }
    }
  } else {
    out.success(`No new files added to ${target}`);
  }
}

function displayResult(result: AddResourceResult, out: ReturnType<typeof resolveOutput>, interactive: boolean, resourceSpec: string): void {
  switch (result.kind) {
    case 'dependency': {
      const { result: depResult, classification } = result;
      const displayPath = formatPathForDisplay(depResult.targetManifest, process.cwd());
      const header = `To: ${depResult.packageName} (${displayPath})`;
      if (interactive) out.info(header);
      else out.success(header);
      if (depResult.wasAutoDetected) {
        out.info(`Detected package at ${classification.localPath} — adding as dependency.`);
        out.message('To copy files instead, use --copy.');
      }
      const versionSuffix = classification.version ? `@${classification.version}` : '';
      out.success(`Added ${depResult.packageName}${versionSuffix} to ${depResult.section}`);
      out.message(`in ${formatPathForDisplay(depResult.targetManifest, process.cwd())}`);
      break;
    }
    case 'workspace-resource':
      if (result.result.data) {
        out.info(`Resolved "${resourceSpec}" from installed workspace resources.`);
        displayAddResults(result.result.data, out, interactive);
      }
      break;
    case 'copy':
      if (result.result.data) {
        displayAddResults(result.result.data, out, interactive);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Command setup
// ---------------------------------------------------------------------------

export async function setupAddCommand(args: any[]): Promise<void> {
  const [resource, options, command] = args as [string | undefined, any, Command];
  const cwd = process.cwd();
  const programOpts = command.parent?.opts() || {};
  const interactive = !resource;

  const execContext = await createCliExecutionContext({
    global: false,
    cwd: programOpts.cwd,
    interactive,
  });

  const policy = createInteractionPolicy({ interactive, force: options.force });
  execContext.interactionPolicy = policy;
  const out = resolveOutput(execContext);

  if (!resource) {
    // Interactive file selector path
    if (!policy.canPrompt(PromptTier.OptionalMenu)) {
      throw new Error(
        '<resource-spec> argument is required in non-interactive mode.\n' +
        'Usage: opkg add <resource-spec> [options]'
      );
    }

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
    out.step(`To: ${pkgLabel} (${formatPathForDisplay(sourcePath, cwd)})`);
    out.connector();

    const selectedFiles = await interactiveFileSelect({ cwd, includeDirs: true });
    if (!selectedFiles || selectedFiles.length === 0) return;

    let filesToProcess: string[];
    if (hasDirectorySelections(selectedFiles)) {
      filesToProcess = await expandDirectorySelections(selectedFiles, cwd);
      out.info(`Found ${filesToProcess.length} total file${filesToProcess.length === 1 ? '' : 's'} to add`);
    } else {
      filesToProcess = selectedFiles;
    }

    const absPaths = filesToProcess.map((f) => join(cwd, f));
    const result = await runAddToSourcePipelineBatch(options.to, absPaths, cwd, { ...options, execContext });
    if (!result.success) throw new Error(result.error || 'Add operation failed');
    if (result.data) displayAddResults(result.data, out, interactive, true);
    return;
  }

  // Non-interactive: delegate to core orchestrator
  const result = await processAddResource(resource, options, cwd, execContext);
  displayResult(result, out, interactive, resource);
}
