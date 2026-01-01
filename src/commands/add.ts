import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runAddToSourcePipeline, type AddToSourceOptions } from '../core/add/add-to-source-pipeline.js';

export function setupAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<package-name>', 'package name')
    .argument('<path>', 'file or directory to add')
    .description(
      'Copy workspace files into a mutable package source (workspace or global packages).\n\n' +
      'This command modifies the package source only. To sync changes to your workspace:\n' +
      '  1. Install the package: opkg install <package-name>\n' +
      '  2. Apply the changes: opkg apply <package-name>\n' +
      'Or use --apply flag to do both (requires package to be installed in current workspace).\n\n' +
      'Usage examples:\n' +
      '  opkg add my-package .cursor/rules/example.md\n' +
      '  opkg add my-package docs/guide.md\n' +
      '  opkg add my-package .cursor/rules/example.md --apply\n\n' +
      'The add command searches for mutable packages in:\n' +
      '  - Workspace packages: ./.openpackage/packages/\n' +
      '  - Global packages: ~/.openpackage/packages/\n\n' +
      'Registry packages are immutable and cannot be modified via add.'
    )
    .option('--platform-specific', 'Save platform-specific variants for platform subdir inputs')
    .option('--apply', 'Apply changes to workspace immediately (requires package to be installed)')
    .action(
      withErrorHandling(async (packageName: string | undefined, pathArg: string | undefined, options: AddToSourceOptions) => {
        const result = await runAddToSourcePipeline(packageName, pathArg, options);
        if (!result.success) {
          throw new Error(result.error || 'Add operation failed');
        }
        
        // Provide helpful feedback
        if (result.data) {
          const { filesAdded, sourcePath, sourceType, packageName: resolvedName } = result.data;
          console.log(`\n✓ Added ${filesAdded} file${filesAdded !== 1 ? 's' : ''} to ${resolvedName}`);
          console.log(`  Source: ${sourcePath}`);
          console.log(`  Type: ${sourceType} package`);
          
          if (!options.apply) {
            console.log(`\n💡 Changes are in the package source only.`);
            console.log(`   To sync to your workspace, run:`);
            console.log(`     opkg install ${resolvedName}`);
            console.log(`     opkg apply ${resolvedName}`);
          }
        }
      })
    );
}
