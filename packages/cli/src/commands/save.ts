/**
 * Save Command (CLI layer)
 *
 * Thin shell over core/save/ pipelines.
 * Resolves a resource-spec to the appropriate save target,
 * then delegates to the direct save flow.
 */

import type { Command } from 'commander';

import type { SaveToSourceOptions } from '@opkg/core/core/save/save-to-source-pipeline.js';
import { runDirectSaveFlow } from '@opkg/core/core/save/direct-save-flow.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput } from '@opkg/core/core/ports/resolve.js';

export async function setupSaveCommand(args: any[]): Promise<void> {
  const [nameArg, options, command] = args as [string, SaveToSourceOptions, Command];
  const programOpts = command.parent?.opts() || {};
  const traverseOpts = {
    programOpts,
  };

  const interactive = !nameArg;
  const ctx = await createCliExecutionContext({
    cwd: programOpts.cwd,
    interactive,
    outputMode: interactive ? 'rich' : 'plain',
  });
  const result = await runDirectSaveFlow(nameArg, options, traverseOpts, ctx);

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
