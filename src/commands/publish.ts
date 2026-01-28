import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runPublishPipeline } from '../core/publish/publish-pipeline.js';
import type { PublishOptions } from '../core/publish/publish-types.js';

export function setupPublishCommand(program: Command): void {
  program
    .command('publish')
    .description('Publish package from current directory to remote registry')
    .option('--profile <profile>', 'profile to use for authentication')
    .option('--api-key <key>', 'API key for authentication (overrides profile)')
    .action(withErrorHandling(async (options: PublishOptions) => {
      const result = await runPublishPipeline(options);
      if (!result.success) {
        throw new Error(result.error || 'Publish operation failed');
      }
    }));
}
