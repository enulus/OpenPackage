import type { UnpublishOptions, UnpublishResult } from './unpublish-types.js';
import { runLocalUnpublishPipeline } from './local-unpublish-pipeline.js';
// Future: import { runRemoteUnpublishPipeline } from './remote-unpublish-pipeline.js';

/**
 * Main unpublish pipeline - routes to local or remote based on options
 */
export async function runUnpublishPipeline(
  packageSpec: string,
  options: UnpublishOptions
): Promise<UnpublishResult> {
  // Route to appropriate pipeline
  if (options.remote) {
    // Future implementation
    throw new Error(
      '--remote option is not yet supported for unpublish.\n' +
      'This version only supports unpublishing from local registry.'
    );
  } else {
    return await runLocalUnpublishPipeline(packageSpec, options);
  }
}
