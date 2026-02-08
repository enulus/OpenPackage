import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runSaveToSourcePipeline, type SaveToSourceOptions } from '../core/save/save-to-source-pipeline.js';

export function setupSaveCommand(program: Command): void {
  program
    .command('save')
    .argument('<package-name>', 'package name to save workspace changes to')
    .description('Save workspace edits back to mutable package source')
    .option('-f, --force', 'auto-select newest when conflicts occur')
    .action(
      withErrorHandling(async (packageName: string, options: SaveToSourceOptions) => {
        const result = await runSaveToSourcePipeline(packageName, options);
        if (!result.success) {
          throw new Error(result.error || 'Save operation failed');
        }
        if (result.data?.message) {
          console.log(result.data.message);
        }
      })
    );
}
