import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runUnpublishPipeline } from '../core/unpublish/unpublish-pipeline.js';
import type { UnpublishOptions } from '../core/unpublish/unpublish-types.js';

export function setupUnpublishCommand(program: Command): void {
  program
    .command('unpublish')
    .argument('[package-spec]', 'package[@version] to unpublish (e.g., my-package@1.0.0)')
    .description('Remove package from local registry (use --remote for remote unpublishing)')
    .option('--remote', 'unpublish from remote registry instead of local')
    .option('--force', 'skip confirmation prompts')
    .option('--profile <profile>', 'profile to use for authentication (remote only)')
    .option('--api-key <key>', 'API key for authentication (remote only, overrides profile)')
    .action(withErrorHandling(async (packageSpec: string | undefined, options: UnpublishOptions) => {
      // Validate package spec is provided
      if (!packageSpec) {
        throw new Error('Package specification is required. Usage: opkg unpublish <package[@version]>');
      }
      
      // Run unpublish pipeline (routes to local or remote)
      const result = await runUnpublishPipeline(packageSpec, options);
      if (!result.success) {
        throw new Error(result.error || 'Unpublish operation failed');
      }
    }));
}
