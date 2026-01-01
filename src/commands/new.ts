import { Command } from 'commander';
import { withErrorHandling } from '../utils/errors.js';
import { createPackage } from '../core/package-creation.js';
import { parseScope, validateScopeWithPackageName, type PackageScope } from '../utils/scope-resolution.js';
import { promptPackageScope } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';

/**
 * Command options for 'opkg new'
 */
interface NewCommandOptions {
  scope?: string;
  force?: boolean;
  nonInteractive?: boolean;
}

/**
 * Setup the 'opkg new' command
 * 
 * This command creates a new package with scope support:
 * - root: Create openpackage.yml in current directory
 * - local: Create in .openpackage/packages/<name>/ (default)
 * - global: Create in ~/.openpackage/packages/<name>/
 */
export function setupNewCommand(program: Command): void {
  program
    .command('new')
    .argument('[package-name]', 'package name (optional - will prompt if not provided in interactive mode)')
    .description(
      'Create a new package with openpackage.yml manifest.\n\n' +
      'Scopes:\n' +
      '  root   - Create in current directory (./openpackage.yml)\n' +
      '  local  - Create in workspace packages (./.openpackage/packages/<name>/)\n' +
      '  global - Create in global packages (~/.openpackage/packages/<name>/)\n\n' +
      'Usage:\n' +
      '  opkg new                              # Interactive: prompt for scope and name\n' +
      '  opkg new my-package                   # Interactive: prompt for scope\n' +
      '  opkg new my-package --scope local     # Create local package (explicit)\n' +
      '  opkg new my-package --scope global    # Create global package\n' +
      '  opkg new --scope root                 # Create root package (prompt for name)\n' +
      '  opkg new my-package --scope root      # Create root package with specified name\n' +
      '  opkg new --non-interactive --scope local my-package  # CI/CD: requires --scope flag'
    )
    .option('--scope <scope>', 'package scope: root, local, or global (required for non-interactive mode)')
    .option('-f, --force', 'overwrite existing package without confirmation')
    .option('--non-interactive', 'skip interactive prompts, use defaults')
    .action(withErrorHandling(async (packageName?: string, options?: NewCommandOptions) => {
      const cwd = process.cwd();

      const isInteractive = !options?.nonInteractive;

      // Parse and validate scope
      let scope: PackageScope;
      
      if (options?.scope) {
        // Scope explicitly provided via flag
        try {
          scope = parseScope(options.scope);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : String(error));
        }
      } else if (isInteractive) {
        // Interactive mode without --scope: prompt user to choose
        scope = await promptPackageScope();
        console.log(); // Add blank line after prompt for better formatting
      } else {
        // Non-interactive mode without --scope: error
        throw new Error(
          'The --scope flag is required in non-interactive mode.\n' +
          'Usage: opkg new [package-name] --scope <root|local|global> --non-interactive\n\n' +
          'Available scopes:\n' +
          '  root   - Create in current directory\n' +
          '  local  - Create in .openpackage/packages/\n' +
          '  global - Create in ~/.openpackage/packages/'
        );
      }

      // Validate scope and package name combination
      try {
        validateScopeWithPackageName(scope, packageName, isInteractive);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }

      logger.debug('Creating new package', {
        scope,
        packageName,
        force: options?.force,
        interactive: isInteractive
      });

      // Create the package
      const result = await createPackage({
        cwd,
        scope,
        packageName,
        force: options?.force || false,
        interactive: !options?.nonInteractive
      });

      if (!result.success) {
        throw new Error(result.error || 'Package creation failed');
      }

      // Get the actual package name from the result context
      const actualPackageName = result.context?.name || packageName;

      // Additional success messaging based on scope
      if (scope === 'local') {
        console.log(`\n💡 Next steps:`);
        console.log(`   1. Add files to your package: cd .openpackage/packages/${actualPackageName}/`);
        console.log(`   2. Install to this workspace: opkg install ${actualPackageName}`);
      } else if (scope === 'global') {
        console.log(`\n💡 Next steps:`);
        console.log(`   1. Add files to your package: cd ~/.openpackage/packages/${actualPackageName}/`);
        console.log(`   2. Install to any workspace: opkg install ${actualPackageName}`);
      } else if (scope === 'root') {
        console.log(`\n💡 Next steps:`);
        console.log(`   1. Add files to your package in current directory`);
        console.log(`   2. Install to other workspaces: opkg install ${actualPackageName}`);
      }
    }));
}
