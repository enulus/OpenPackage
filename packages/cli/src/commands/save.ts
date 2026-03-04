/**
 * Save Command (CLI layer)
 *
 * Thin shell over core/save/ pipelines.
 * Resolves a resource-spec to the appropriate save target,
 * then delegates to the direct save flow.
 */

import type { Command } from 'commander';

import type { SaveToSourceOptions } from '@opkg/core/core/save/save-to-source-pipeline.js';
import { normalizeSaveOptions } from '@opkg/core/core/save/save-options-normalizer.js';
import { toSaveJsonOutput } from '@opkg/core/core/save/save-result-reporter.js';
import { runDirectSaveFlow } from '@opkg/core/core/save/direct-save-flow.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput } from '@opkg/core/core/ports/resolve.js';
import { printJson } from '../utils/json-output.js';

interface SaveCommandOptions extends SaveToSourceOptions {
  json?: boolean;
}

export async function setupSaveCommand(args: any[]): Promise<void> {
  const [nameArg, options, command] = args as [string, SaveCommandOptions, Command];
  const programOpts = command.parent?.opts() || {};
  const traverseOpts = {
    programOpts,
  };

  // Normalize options at CLI boundary (validates --conflicts, aliases --force, etc.)
  const normalized = normalizeSaveOptions(options);

  // Build pipeline options from normalized values
  const pipelineOptions: SaveToSourceOptions = {
    force: options.force,
    dryRun: normalized.dryRun,
    conflicts: normalized.conflicts,
    prefer: normalized.prefer,
  };

  const interactive = !nameArg;
  const ctx = await createCliExecutionContext({
    cwd: programOpts.cwd,
    interactive,
    outputMode: interactive ? 'rich' : 'plain',
  });
  const result = await runDirectSaveFlow(nameArg, pipelineOptions, traverseOpts, ctx);

  // JSON output path
  if (options.json) {
    if (result.cancelled) {
      printJson({ success: false, cancelled: true });
      return;
    }
    if (result.result) {
      if (!result.result.success) {
        printJson({ success: false, error: result.result.error });
        process.exitCode = 1;
        return;
      }
      if (result.result.data?.report) {
        printJson(toSaveJsonOutput(result.result.data.report));
      } else {
        printJson({ success: true, message: result.result.data?.message });
      }
    }
    return;
  }

  // Human-readable output path
  if (result.cancelled) {
    const out = resolveOutput(ctx);
    out.info('Save cancelled');
    return;
  }

  if (result.result) {
    const out = resolveOutput(ctx);
    if (!result.result.success) {
      throw new Error(result.result.error || 'Save operation failed');
    }
    if (result.result.data?.message) {
      out.success(result.result.data.message);
    }
  }
}
