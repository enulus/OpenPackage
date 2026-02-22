import { createPackage } from '@opkg/core/core/package-creation.js';
import { parseScope, type PackageScope } from '@opkg/core/utils/scope-resolution.js';
import { logger } from '@opkg/core/utils/logger.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput, resolvePrompt } from '@opkg/core/core/ports/resolve.js';

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
  const ctx = await createCliExecutionContext();
  const out = resolveOutput(ctx);
  const prm = resolvePrompt(ctx);

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
    packageName = await prm.text('Enter package name:', {
      placeholder: 'my-package',
      validate: (value: string) => {
        if (!value || value.trim().length === 0) return 'Package name is required';
        if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(value.trim())) {
          return 'Package name must be lowercase alphanumeric, can contain dots, hyphens, underscores';
        }
        return true;
      }
    });
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
    out.note(
      `1. Add files to your package: opkg add <file-or-dir> --to ${actualPackageName}\n` +
      `2. Install to workspace: opkg install ${customPath}`,
      'Next steps'
    );
  } else if (scope === 'project') {
    out.note(
      `1. Add files to your package: opkg add <file-or-dir> --to ${actualPackageName}\n` +
      `2. Install to this workspace: opkg install ${actualPackageName}`,
      'Next steps'
    );
  } else if (scope === 'global') {
    out.note(
      `1. Add files to your package: opkg add <file-or-dir> --to ${actualPackageName}\n` +
      `2. Install to any workspace: opkg install ${actualPackageName}`,
      'Next steps'
    );
  } else if (scope === 'root') {
    out.note(
      `1. Add files to your package: opkg add <file-or-dir>\n` +
      `2. Install to other workspaces: opkg install ${actualPackageName}`,
      'Next steps'
    );
  }
}
