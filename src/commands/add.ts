import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runAddToSourcePipeline, type AddToSourceOptions } from '../core/add/add-to-source-pipeline.js';

export function setupAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<package-name>', 'package name')
    .argument('<path>', 'file or directory to add')
    .description(
      'Copy supported workspace files or directories into a local package directory.\n' +
      'Usage examples:\n' +
      '  opkg add my-package .cursor/rules/example.md\n' +
      '  opkg add my-package docs/guide.md   # stored as root/docs/guide.md in the package\n'
    )
    .option('--platform-specific', 'Save platform-specific variants for platform subdir inputs')
    .option('--apply', 'Apply immediately after add')
    .action(
      withErrorHandling(async (packageName: string | undefined, pathArg: string | undefined, options: AddToSourceOptions) => {
        const result = await runAddToSourcePipeline(packageName, pathArg, options);
        if (!result.success) {
          throw new Error(result.error || 'Add operation failed');
        }
      })
    );
}
