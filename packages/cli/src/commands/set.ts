/**
 * @fileoverview Command setup for 'opkg set'
 * 
 * Updates manifest fields in openpackage.yml for mutable packages.
 */

import { runSetPipeline } from '@opkg/core/core/set/set-pipeline.js';
import type { SetCommandOptions } from '@opkg/core/core/set/set-types.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolvePrompt } from '@opkg/core/core/ports/resolve.js';

/**
 * Setup the 'opkg set' command
 */
export async function setupSetCommand(args: any[]): Promise<void> {
  const [packageInput, options] = args as [string | undefined, SetCommandOptions];
  const ctx = await createCliExecutionContext();
  const prompt = resolvePrompt(ctx);
  const result = await runSetPipeline(packageInput, options, prompt);
  if (!result.success) {
    throw new Error(result.error || 'Set operation failed');
  }
}
