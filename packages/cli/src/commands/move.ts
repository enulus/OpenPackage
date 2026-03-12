/**
 * CLI handler for the `opkg move` command.
 *
 * Supports both interactive (no args) and non-interactive modes.
 */

import type { Command } from 'commander';
import { runMovePipeline, type MoveOptions } from '@opkg/core/core/move/move-pipeline.js';
import { createCliExecutionContext } from '../cli/context.js';
import { createInteractionPolicy, PromptTier } from '@opkg/core/core/interaction-policy.js';
import { resolveOutput, resolvePrompt } from '@opkg/core/core/ports/resolve.js';
import { formatPathForDisplay } from '@opkg/core/utils/formatters.js';

export async function setupMoveCommand(args: any[]): Promise<void> {
  const [resource, newName, options, command] = args as [
    string | undefined,
    string | undefined,
    MoveOptions,
    Command,
  ];
  const programOpts = command.parent?.opts() || {};

  // Determine interactive mode: interactive when no resource arg, plain otherwise
  const interactive = !resource;

  const execContext = await createCliExecutionContext({
    global: false,
    cwd: programOpts.cwd,
    interactive,
    outputMode: interactive ? 'rich' : 'plain',
  });

  const policy = createInteractionPolicy({
    interactive,
    force: options.force,
  });
  execContext.interactionPolicy = policy;

  const out = resolveOutput(execContext);

  // Interactive mode: prompt for resource and new name
  if (!resource) {
    if (!policy.canPrompt(PromptTier.OptionalMenu)) {
      throw new Error(
        '<resource> argument is required in non-interactive mode.\n' +
        'Usage: opkg move <resource> <new-name> [options]\n\n' +
        'Examples:\n' +
        '  opkg move agents/my-agent new-agent        # rename agent\n' +
        '  opkg move skills/foo --to other-pkg         # relocate skill\n' +
        '  opkg move agents/foo bar --to other-pkg     # rename + relocate\n' +
        '  opkg move                                   # interactive mode (TTY only)'
      );
    }

    const prm = resolvePrompt(execContext);

    // Step 1: Prompt for resource name
    const resourceAnswer = await prm.text('Resource to rename/move (e.g., agents/my-agent):', {
      placeholder: 'type/name',
    });

    if (!resourceAnswer || typeof resourceAnswer !== 'string') {
      return;
    }

    // Step 2: Prompt for new name
    const newNameAnswer = await prm.text('New name (leave empty to keep current name):', {
      placeholder: 'new-name',
    });

    // Step 3: Prompt for destination package
    const toAnswer = await prm.text('Destination package (leave empty to keep in same package):', {
      placeholder: 'package-name',
    });

    const effectiveNewName = (typeof newNameAnswer === 'string' && newNameAnswer.trim())
      ? newNameAnswer.trim()
      : undefined;
    const effectiveTo = (typeof toAnswer === 'string' && toAnswer.trim())
      ? toAnswer.trim()
      : undefined;

    const result = await runMovePipeline(
      resourceAnswer.trim(),
      effectiveNewName,
      { ...options, to: effectiveTo },
      execContext,
    );

    if (!result.success) {
      throw new Error(result.error || 'Move operation failed.');
    }

    if (result.data) {
      formatOutput(result.data, options, execContext.targetDir, out);
    }
    return;
  }

  // Non-interactive mode
  const result = await runMovePipeline(resource, newName, options, execContext);

  if (!result.success) {
    throw new Error(result.error || 'Move operation failed.');
  }

  if (result.data) {
    if (options.json) {
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      formatOutput(result.data, options, execContext.targetDir, out);
    }
  }
}

function formatOutput(
  data: NonNullable<Awaited<ReturnType<typeof runMovePipeline>>['data']>,
  options: MoveOptions,
  cwd: string,
  out: ReturnType<typeof resolveOutput>,
): void {
  const dryPrefix = data.dryRun ? '(dry-run) ' : '';
  const sourcePath = formatPathForDisplay(data.sourcePath, cwd);

  switch (data.action) {
    case 'rename':
      out.success(
        `${dryPrefix}Renamed ${data.resourceName} -> ${data.newName} in ${data.sourcePackage} (${sourcePath})`
      );
      if (data.renamedFiles) {
        out.message(`  ${data.renamedFiles} file${data.renamedFiles !== 1 ? 's' : ''} updated`);
      }
      break;

    case 'relocate':
      out.success(
        `${dryPrefix}Moved ${data.resourceName}${data.sourcePackage ? ` from ${data.sourcePackage}` : ''} to ${data.destPackage}`
      );
      if (data.movedFiles) {
        out.message(`  ${data.movedFiles} file${data.movedFiles !== 1 ? 's' : ''} moved`);
      }
      break;

    case 'rename-relocate':
      out.success(
        `${dryPrefix}Renamed ${data.resourceName} -> ${data.newName} and moved to ${data.destPackage}`
      );
      if (data.renamedFiles) {
        out.message(`  ${data.renamedFiles} file${data.renamedFiles !== 1 ? 's' : ''} renamed`);
      }
      if (data.movedFiles) {
        out.message(`  ${data.movedFiles} file${data.movedFiles !== 1 ? 's' : ''} moved`);
      }
      break;

    case 'adopt':
      out.success(
        `${dryPrefix}Adopted ${data.resourceName} into ${data.destPackage}`
      );
      if (data.movedFiles) {
        out.message(`  ${data.movedFiles} file${data.movedFiles !== 1 ? 's' : ''} added`);
      }
      break;
  }
}
