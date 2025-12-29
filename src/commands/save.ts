import { Command } from 'commander';
import { SaveOptions, CommandResult } from '../types/index.js';
import { withErrorHandling } from '../utils/errors.js';
import { runSaveToSourcePipeline } from '../core/save/save-to-source-pipeline.js';
import { runAddToSourcePipeline, type AddToSourceOptions } from '../core/add/add-to-source-pipeline.js';

type SaveCommandOptions = Pick<SaveOptions, 'force'> & Pick<AddToSourceOptions, 'apply' | 'platformSpecific'>;

async function savePackageCommand(
  packageName: string | undefined,
  pathArg: string | undefined,
  options: SaveCommandOptions = {}
): Promise<CommandResult> {
  const hasPath = Boolean(pathArg);

  if (hasPath && !packageName) {
    throw new Error(
      "When providing a path, you must also specify a package name. " +
      "To add files without saving, run: opkg add <package-name> <path>"
    );
  }

  if (hasPath) {
    const addResult = await runAddToSourcePipeline(packageName, pathArg, {
      platformSpecific: options.platformSpecific,
      apply: options.apply
    });
    if (!addResult.success) throw new Error(addResult.error || 'Add operation failed');
  }

  return runSaveToSourcePipeline(packageName, {
    force: options.force
  });
}

export function setupSaveCommand(program: Command): void {
  program
    .command('save')
    .alias('s')
    .argument('[package-name]', 'package name (required when providing a path)')
    .argument('[path]', 'file or directory to add before saving')
    .description(
      'Sync workspace edits back to a mutable package source based on unified index mappings.\n' +
      'Usage:\n' +
      '  opkg save <package-name>\n' +
      '  opkg save <package-name> <path>   # Add path to package (copy-to-root for non-platform paths), then save\n'
    )
    .option('-f, --force', 'auto-select latest mtime when conflicts occur')
    .option('--platform-specific', 'Treat platform subdir inputs as platform-specific when adding before save')
    .option('--apply', 'Apply after add-before-save to sync platforms')
    .action(
      withErrorHandling(async (packageName: string | undefined, path: string | undefined, options?: SaveCommandOptions) => {
        const result = await savePackageCommand(packageName, path, options ?? {});
        if (!result.success) throw new Error(result.error || 'Save operation failed');
      })
    );
}
