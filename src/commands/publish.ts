import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runPublishPipeline } from '../core/publish/publish-pipeline.js';
import type { PublishOptions } from '../core/publish/publish-types.js';

export function setupPublishCommand(program: Command): void {
  program
    .command('publish')
    .argument('[package]', 'package name or path (optional if cwd is a package)')
    .description('Publish package to local registry (use --remote for remote publishing)')
    .option('--remote', 'publish to remote registry instead of local')
    .option('--force', 'overwrite existing version without confirmation')
    .option('--output <path>', 'write to custom directory instead of registry (local only)')
    .option('--profile <profile>', 'profile to use for authentication (remote only)')
    .option('--api-key <key>', 'API key for authentication (remote only, overrides profile)')
    .action(withErrorHandling(async (packageInput: string | undefined, options: PublishOptions) => {
      // Validate option combinations
      if (options.output && options.remote) {
        throw new Error('--output option is only supported for local publishing (cannot be used with --remote)');
      }
      
      // Pass packageInput to pipeline
      const result = await runPublishPipeline(packageInput, options);
      if (!result.success) {
        throw new Error(result.error || 'Publish operation failed');
      }
    }));
}
