import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runPublishPipeline } from '../core/publish/publish-pipeline.js';
import type { PublishOptions } from '../core/publish/publish-types.js';

export function setupPublishCommand(program: Command): void {
  program
    .command('publish')
    .description('Publish package to local registry (use --remote for remote publishing)')
    .option('--remote', 'publish to remote registry instead of local')
    .option('--force', 'overwrite existing version without confirmation')
    .option('--profile <profile>', 'profile to use for authentication (remote only)')
    .option('--api-key <key>', 'API key for authentication (remote only, overrides profile)')
    .action(withErrorHandling(async (options: PublishOptions) => {
      const result = await runPublishPipeline(options);
      if (!result.success) {
        throw new Error(result.error || 'Publish operation failed');
      }
    }));
}
