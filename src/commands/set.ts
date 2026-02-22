/**
 * @fileoverview Command setup for 'opkg set'
 * 
 * Updates manifest fields in openpackage.yml for mutable packages.
 */

import { runSetPipeline } from '../core/set/set-pipeline.js';
import type { SetCommandOptions } from '../core/set/set-types.js';

/**
 * Setup the 'opkg set' command
 */
export async function setupSetCommand(args: any[]): Promise<void> {
  const [packageInput, options] = args as [string | undefined, SetCommandOptions];
  const result = await runSetPipeline(packageInput, options);
  if (!result.success) {
    throw new Error(result.error || 'Set operation failed');
  }
}
