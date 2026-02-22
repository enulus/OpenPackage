import { runPublishPipeline } from '../core/publish/publish-pipeline.js';
import type { PublishOptions } from '../core/publish/publish-types.js';

export async function setupPublishCommand(args: any[]): Promise<void> {
  const [packageInput, options] = args as [string | undefined, PublishOptions];
  // Pass packageInput to pipeline
  const result = await runPublishPipeline(packageInput, options);
  if (!result.success) {
    throw new Error(result.error || 'Publish operation failed');
  }
}
