import { Command } from 'commander';
import { PackOptions, CommandResult } from '../types/index.js';
import { withErrorHandling } from '../utils/errors.js';
import { runPackPipeline } from '../core/pack/pack-pipeline.js';

async function packPackageCommand(
  packageName: string | undefined,
  options?: PackOptions
): Promise<CommandResult> {
  return runPackPipeline(packageName, options);
}

export function setupPackCommand(program: Command): void {
  program
    .command('pack')
    .argument('[package]', 'package name or path (optional if cwd is a package)')
    .description(
      'Snapshot the package source into the local registry directory.\n' +
      'Usage:\n' +
      '  opkg pack                     # Pack cwd package (requires openpackage.yml)\n' +
      '  opkg pack <package-name>      # Pack specific package by name\n' +
      '  opkg pack <path>              # Pack package at the specified path\n' +
      '  opkg pack /absolute/path      # Pack package from absolute path\n' +
      '  opkg pack ./relative/path     # Pack package from relative path'
    )
    .option('-f, --force', 'skip confirmation and overwrite existing packages')
    .option('--output <path>', 'write snapshot directly into the target directory instead of the registry path')
    .option('--dry-run', 'print the destination and files that would be written')
    .action(withErrorHandling(async (packageName: string | undefined, options?: PackOptions) => {
      const result = await packPackageCommand(packageName, options);
      if (!result.success) {
        throw new Error(result.error || 'Pack operation failed');
      }
    }));
}

