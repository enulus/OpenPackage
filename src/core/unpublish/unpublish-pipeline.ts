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
  if (!options.local) {
    // Remote unpublish - not yet implemented
    throw new Error(
      'Remote unpublish is not yet supported.\n' +
      'Use --local flag to unpublish from local registry (~/.openpackage/registry).'
    );
  } else {
    return await runLocalUnpublishPipeline(packageSpec, options);
  }
}
