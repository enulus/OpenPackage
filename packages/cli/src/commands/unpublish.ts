/**
 * Unpublish Command (CLI layer)
 *
 * Thin shell over core/unpublish/ pipelines.
 * Handles CLI arg parsing and delegates to core flows.
 */

import { UserCancellationError } from '@opkg/core/utils/errors.js';
import { runUnpublishPipeline } from '@opkg/core/core/unpublish/unpublish-pipeline.js';
import type { UnpublishOptions } from '@opkg/core/core/unpublish/unpublish-types.js';
import { runInteractiveUnpublishFlow } from '@opkg/core/core/unpublish/interactive-unpublish-flow.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput, resolvePrompt } from '@opkg/core/core/ports/resolve.js';

interface UnpublishCommandOptions extends UnpublishOptions {
  interactive?: boolean;
}

export async function setupUnpublishCommand(args: any[]): Promise<void> {
  const [packageSpec, options] = args as [string | undefined, UnpublishCommandOptions];
  const ctx = await createCliExecutionContext();
  const out = resolveOutput(ctx);
  const prm = resolvePrompt(ctx);

  if (options.interactive) {
    options.local = true;
    try {
      const result = await runInteractiveUnpublishFlow(packageSpec, options, out, prm);
      if (result.unpublishedVersions.length > 0) {
        out.success(`Unpublished ${result.unpublishedVersions.length} version${result.unpublishedVersions.length === 1 ? '' : 's'} of ${result.packageName}`);
      }
    } catch (error) {
      if (error instanceof UserCancellationError) {
        out.info('Unpublish cancelled.');
        return;
      }
      throw error;
    }
    return;
  }

  if (!packageSpec) {
    throw new Error('Package specification is required. Usage: opkg unpublish <package[@version]> or use --interactive');
  }

  const result = await runUnpublishPipeline(packageSpec, options);
  if (!result.success) {
    throw new Error(result.error || 'Unpublish operation failed');
  }
}
