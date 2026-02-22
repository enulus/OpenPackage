import { createPackage } from '../core/package-creation.js';
import { parseScope, type PackageScope } from '../utils/scope-resolution.js';
import { promptPackageName } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';

/**
 * Command options for 'opkg new'
 */
interface NewCommandOptions {
  scope?: string;
  path?: string;
  force?: boolean;
}

/**
 * Setup the 'opkg new' command
 * 
 * This command creates a new package with scope support:
 * - root: Create openpackage.yml in current directory
 * - project: Create in .openpackage/packages/<name>/
 * - global: Create in ~/.openpackage/packages/<name>/ (default)
 * - custom: Create at a user-specified path
 * 
 * Creates a minimal package with only the name field set.
 * Use 'opkg set' to configure additional metadata (description, keywords, etc.)
 */
export async function setupNewCommand(args: any[]): Promise<void> {
  let [packageName, options] = args as [string | undefined, NewCommandOptions | undefined];
  const cwd = process.cwd();

  // Parse and validate scope or custom path
  let scope: PackageScope | undefined;
  let customPath: string | undefined;
  
  if (options?.path) {
    // Custom path explicitly provided via flag
    customPath = options.path;
    
    // Warn if --scope is also provided
    if (options?.scope) {
      logger.warn('--scope is ignored when --path is specified');
    }
  } else if (options?.scope) {
    // Scope explicitly provided via flag
    try {
      scope = parseScope(options.scope);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  } else {
    // No scope or path provided: default to global
    scope = 'global';
  }

  // Prompt for package name if not provided
  if (!packageName) {
    packageName = await promptPackageName();
  }

  logger.debug('Creating new package', {
    scope,
    customPath,
    packageName,
    force: options?.force
  });

  // Create the package
  const result = await createPackage({
    cwd,
    scope,
    customPath,
    packageName,
    force: options?.force || false
  });

  if (!result.success) {
    throw new Error(result.error || 'Package creation failed');
  }

  // Get the actual package name from the result context
  const actualPackageName = result.context?.name || packageName;

  // Additional success messaging based on scope or custom path
  if (customPath) {
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Add files to your package: opkg add <file-or-dir> --to ${actualPackageName}`);
    console.log(`   2. Install to workspace: opkg install ${customPath}`);
  } else if (scope === 'project') {
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Add files to your package: opkg add <file-or-dir> --to ${actualPackageName}`);
    console.log(`   2. Install to this workspace: opkg install ${actualPackageName}`);
  } else if (scope === 'global') {
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Add files to your package: opkg add <file-or-dir> --to ${actualPackageName}`);
    console.log(`   2. Install to any workspace: opkg install ${actualPackageName}`);
  } else if (scope === 'root') {
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Add files to your package: opkg add <file-or-dir>`);
    console.log(`   2. Install to other workspaces: opkg install ${actualPackageName}`);
  }
}
