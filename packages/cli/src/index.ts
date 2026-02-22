import { Command } from 'commander';
import { logger } from '@opkg/core/utils/logger.js';
import * as path from 'path';
import fs from 'fs/promises';
import { constants } from 'fs';
import { ensureOpenPackageDirectories } from '@opkg/core/core/directory.js';
import { getVersion } from '@opkg/core/utils/package.js';
import { withErrorHandling } from '@opkg/core/utils/errors.js';

/**
 * OpenPackage CLI - Main entry point
 * 
 * Commands are lazily loaded via dynamic import() to minimize cold-start time.
 * Only the invoked command's module tree is loaded at runtime.
 */

// Create the main program
const program = new Command();

// Configure the main program
program
  .name('openpackage')
  .alias('opkg ')
  .description('OpenPackage - The Package Manager for AI Coding')
  .version(getVersion())
  .option('--cwd <dir>', 'set working directory')
  .configureHelp({
    sortSubcommands: true,
    // Customize help to be concise
    formatHelp: (cmd, helper) => {
      const termWidth = helper.padWidth(cmd, helper);
      
      // Only customize for root command - use default for subcommands
      if (cmd.name() !== 'openpackage') {
        // Build default help for subcommands
        let output = '';
        
        output += `Usage: ${helper.commandUsage(cmd)}\n\n`;
        
        if (cmd.description()) {
          output += `${cmd.description()}\n\n`;
        }
        
        const args = helper.visibleArguments(cmd);
        if (args.length > 0) {
          output += 'Arguments:\n';
          args.forEach((arg: any) => {
            output += `  ${helper.argumentTerm(arg).padEnd(termWidth)}${helper.argumentDescription(arg)}\n`;
          });
          output += '\n';
        }
        
        const options = helper.visibleOptions(cmd);
        if (options.length > 0) {
          output += 'Options:\n';
          options.forEach((opt: any) => {
            output += `  ${helper.optionTerm(opt).padEnd(termWidth)}${helper.optionDescription(opt)}\n`;
          });
          output += '\n';
        }
        
        const commands = helper.visibleCommands(cmd);
        if (commands.length > 0) {
          output += 'Commands:\n';
          commands.forEach((subCmd: any) => {
            output += `  ${helper.subcommandTerm(subCmd).padEnd(termWidth)}${helper.subcommandDescription(subCmd)}\n`;
          });
          output += '\n';
        }
        
        return output;
      }
      
      // Build concise help sections
      let output = '';
      
      // Title
      output += `opkg|openpackage <command>\n\n`;
      
      // Usage section with common commands
      output += 'Usage:\n\n';
      output += 'opkg install           install packages from openpackage.yml\n';
      output += 'opkg install <pkg>     install a specific package\n';
      output += 'opkg new               create a new package\n';
      output += 'opkg <command> -h      help on <command>\n\n';
      
      // Global options (must stay visible even with custom root help)
      output += 'Global options:\n\n';
      output += '    --cwd <dir>        set working directory\n\n';
      
      // All commands section - ultra compact
      output += 'All commands:\n\n';
      output += '    install, uninstall, list,\n';
      output += '    new, add, remove, save, set,\n';
      output += '    publish, unpublish, search, view,\n';
      output += '    login, logout, config\n\n';
      
      // Version
      const version = cmd.version();
      if (version) {
        output += `opkg@${version}\n`;
      }
      
      return output;
    }
  });

// =============================================================================
// LAZY-LOADED COMMANDS
// 
// Each command defines its arguments/options inline (cheap string metadata),
// but defers loading the handler module until the command is actually invoked.
// This means `opkg install foo` only loads install-related code, not all 15
// command modules and their transitive dependency trees.
// =============================================================================

// === PACKAGE AUTHORING COMMANDS ===

program
  .command('new')
  .argument('[package-name]', 'package name (will prompt if not provided)')
  .description('Create a new package with minimal manifest (use "opkg set" to configure metadata)')
  .option('--scope <scope>', 'package scope: root, project, or global (default: global)')
  .option('--path <path>', 'custom path for package directory (overrides scope)')
  .option('-f, --force', 'overwrite existing package without confirmation')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupNewCommand } = await import('./commands/new.js');
    await setupNewCommand(args);
  }));

program
  .command('add')
  .argument('[resource-spec]',
    'resource to add (package[@version], gh@owner/repo, https://github.com/owner/repo, or /path/to/file). If omitted, shows interactive file selector.')
  .description('Add a dependency to openpackage.yml or copy files to a package')
  .option('--to <package-name>', 'target package (for dependency: which manifest; for copy: which package source)')
  .option('--dev', 'add to dev-dependencies instead of dependencies')
  .option('--copy', 'force copy mode (copy files instead of recording dependency)')
  .option('--platform-specific', 'save platform-specific variants for platform subdir inputs')
  .option('--force', 'overwrite existing files without prompting')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupAddCommand } = await import('./commands/add.js');
    await setupAddCommand(args);
  }));

program
  .command('remove')
  .alias('rm')
  .argument('[resource-spec]', 'file, directory, or dependency to remove. If omitted, shows interactive file selector.')
  .description('Remove files or dependencies from a mutable package source or workspace package')
  .option('--from <package-name>', 'source package name (defaults to workspace package)')
  .option('--force', 'Skip confirmation prompts')
  .option('--dry-run', 'Preview what would be removed without actually deleting')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupRemoveCommand } = await import('./commands/remove.js');
    await setupRemoveCommand(args);
  }));

program
  .command('save')
  .argument('<package-spec>', 'resource spec to save workspace changes to')
  .description('Save workspace edits back to mutable package source')
  .option('-f, --force', 'auto-select newest when conflicts occur')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupSaveCommand } = await import('./commands/save.js');
    await setupSaveCommand(args);
  }));

program
  .command('set')
  .argument('<field>', 'manifest field to set (name, version, description, author, license, keywords, homepage, repository)')
  .argument('[value]', 'value to set (omit for interactive prompt)')
  .description('Set a field in the package manifest (openpackage.yml)')
  .option('--package <name>', 'target package name (defaults to workspace package)')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupSetCommand } = await import('./commands/set.js');
    await setupSetCommand(args);
  }));

// === INSTALL / MANAGE COMMANDS ===

program
  .command('install')
  .alias('i')
  .description('Install packages to workspace')
  .argument(
    '[resource-spec]',
    'resource to install (package[@version], gh@owner/repo, https://github.com/owner/repo, /path/to/local, or git@host:repo.git)'
  )
  .option('-g, --global', 'install to home directory (~/) instead of current workspace')
  .option('-a, --agents <names...>', 'install specific agents by name (matches frontmatter name or filename)')
  .option('-s, --skills <names...>', 'install specific skills by name (matches SKILL.md frontmatter name or directory name)')
  .option('-r, --rules <names...>', 'install specific rules by name (matches frontmatter name or filename)')
  .option('-c, --commands <names...>', 'install specific commands by name (matches frontmatter name or filename)')
  .option('--plugins <names...>', 'install specific plugins from marketplace (bypasses interactive selection)')
  .option('--platforms <platforms...>', 'install to specific platforms (e.g., cursor claudecode opencode)')
  .option('-i, --interactive', 'interactively select resources to install (agents, skills, commands, etc.)')
  .option('--dry-run', 'preview changes without applying them')
  .option('--force', 'overwrite existing files')
  .option('--conflicts <strategy>', 'conflict handling strategy: namespace, overwrite, skip, or ask')
  .option('--dev', 'add resource to dev-dependencies (instead of dependencies)')
  .option('--remote', 'pull and install from remote registry, ignoring local versions')
  .option('--local', 'resolve and install using only local registry versions, skipping remote metadata and pulls')
  .option('--profile <profile>', 'profile to use for authentication')
  .option('--api-key <key>', 'API key for authentication (overrides profile)')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupInstallCommand } = await import('./commands/install.js');
    await setupInstallCommand(args);
  }));

program
  .command('uninstall')
  .alias('un')
  .description('Remove installed resources or packages')
  .argument('[resource-spec]', 'name of the resource or package to uninstall')
  .option('-g, --global', 'uninstall from home directory (~/) instead of current workspace')
  .option('--dry-run', 'preview changes without applying them')
  .option('-i, --interactive', 'interactively select items to uninstall')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupUninstallCommand } = await import('./commands/uninstall.js');
    await setupUninstallCommand(args);
  }));

// === QUERY COMMANDS ===

program
  .command('list')
  .alias('ls')
  .description('List installed resources and packages')
  .argument('[resource-spec]', 'filter by a specific installed package')
  .option('-s, --scope <scope>', 'workspace scope: project or global (default: both)')
  .option('-d, --deps', 'show dependency tree (full tree including transitive dependencies)')
  .option('-f, --files', 'show individual file paths')
  .option('-t, --tracked', 'show only tracked resources (skip untracked scan)')
  .option('-u, --untracked', 'show only untracked resources')
  .option('--platforms <platforms...>', 'filter by specific platforms (e.g., cursor, claude)')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupListCommand } = await import('./commands/list.js');
    await setupListCommand(args);
  }));

program
  .command('search')
  .description('Search available packages across local sources')
  .argument('[query]', 'filter by package name, keywords, or description')
  .option('-p, --project', 'search project packages only (./.openpackage/packages)')
  .option('-g, --global', 'search global packages only (~/.openpackage/packages)')
  .option('-r, --registry', 'search local registry only (~/.openpackage/registry)')
  .option('-a, --all', 'show all versions for registry packages (default: latest only)')
  .option('--json', 'output results as JSON')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupSearchCommand } = await import('./commands/search.js');
    await setupSearchCommand(args);
  }));

program
  .command('view')
  .description('View package details')
  .argument('[package-spec]', 'package name or path to view')
  .option('-s, --scope <scope>', 'workspace scope: project or global (default: both)')
  .option('-f, --files', 'show individual file paths')
  .option('--remote', 'view remote package details')
  .option('--profile <profile>', 'profile to use for authentication')
  .option('--api-key <key>', 'API key for authentication (overrides profile)')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupViewCommand } = await import('./commands/view.js');
    await setupViewCommand(args);
  }));

// === PUBLISHING COMMANDS ===

program
  .command('publish')
  .argument('[package-spec]', 'package name or path (optional if cwd is a package)')
  .description('Publish package to remote registry (use --local for local publishing)')
  .option('--local', 'publish to local registry (~/.openpackage/registry)')
  .option('--force', 'overwrite existing version without confirmation')
  .option('--profile <profile>', 'profile to use for authentication (remote only)')
  .option('--api-key <key>', 'API key for authentication (remote only, overrides profile)')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupPublishCommand } = await import('./commands/publish.js');
    await setupPublishCommand(args);
  }));

program
  .command('unpublish')
  .argument('[package-spec]', 'package name to unpublish (optional, interactive if omitted)')
  .description('Remove a package or version from the local registry')
  .option('--all', 'unpublish all versions')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupUnpublishCommand } = await import('./commands/unpublish.js');
    await setupUnpublishCommand(args);
  }));

// === CONFIGURATION COMMANDS ===

program
  .command('configure')
  .alias('config')
  .description('Configure default profile and authentication')
  .option('--profile <name>', 'profile name to configure')
  .option('--list', 'list all configured profiles')
  .option('--delete <name>', 'delete the specified profile')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupConfigureCommand } = await import('./commands/configure.js');
    await setupConfigureCommand(args);
  }));

program
  .command('login')
  .description('Authenticate with OpenPackage')
  .option('--profile <profile>', 'profile to use for authentication')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupLoginCommand } = await import('./commands/login.js');
    await setupLoginCommand(args);
  }));

program
  .command('logout')
  .description('Remove stored credentials')
  .option('--profile <profile>', 'profile to log out')
  .action(withErrorHandling(async (...args: any[]) => {
    const { setupLogoutCommand } = await import('./commands/logout.js');
    await setupLogoutCommand(args);
  }));

// =============================================================================
// HOOKS AND ERROR HANDLING
// =============================================================================

program.hook('preAction', async (thisCommand) => {
  const opts = program.opts();
  
  // Only validate --cwd if provided (no directory changes)
  if (opts.cwd) {
    const resolvedCwd = path.resolve(process.cwd(), opts.cwd);
    try {
      const stats = await fs.stat(resolvedCwd);
      if (!stats.isDirectory()) {
        throw new Error(`'${opts.cwd}' is not a directory`);
      }
      await fs.access(resolvedCwd, constants.R_OK | constants.W_OK);
      logger.info(`Working directory will be: ${resolvedCwd}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Invalid --cwd provided', { error: errMsg, cwd: opts.cwd });
      console.error(`Invalid --cwd '${opts.cwd}': Directory must exist, be accessible, and writable. Details: ${errMsg}`);
      process.exit(1);
    }
  } else {
    logger.debug(`Working directory: ${process.cwd()}`);
  }
});

// === GLOBAL ERROR HANDLING ===

/**
 * Handle uncaught exceptions gracefully
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception occurred', { error: error.message, stack: error.stack });
  console.error('An unexpected error occurred. Please check the logs for details.');
  process.exit(1);
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  console.error('An unexpected error occurred. Please check the logs for details.');
  process.exit(1);
});

/**
 * Initialize OpenPackage directories on startup
 */
async function initializeOpenPackage(): Promise<void> {
  try {
    await ensureOpenPackageDirectories();
    logger.debug('OpenPackage directories initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize OpenPackage directories', { error });
    console.error('Failed to initialize OpenPackage directories. Please check permissions.');
    process.exit(1);
  }
}

/**
 * Main execution function
 */
export async function run(): Promise<void> {
  try {
    // Initialize OpenPackage directories
    await initializeOpenPackage();
    
    // If no arguments provided (just 'opkg'), show help and exit successfully
    if (process.argv.length <= 2) {
      program.outputHelp();
      process.exit(0);
    }
    
    // Parse command line arguments
    await program.parseAsync();
    
  } catch (error) {
    logger.error('CLI execution failed', { error });
    console.error('Command execution failed. Use --help for usage information.');
    process.exit(1);
  }
}

// Only run main if this file is executed directly
// Check if this module is the main module being executed
// Note: When running via bin/openpackage, the wrapper script calls run() explicitly
if (process.argv[1] && (
    process.argv[1].endsWith('index.js') ||
    process.argv[1].endsWith('index.ts')
  )) {
  run().catch((error) => {
    logger.error('Fatal error in main execution', { error });
    console.error('Fatal error occurred. Exiting.');
    process.exit(1);
  });
}

// Export the program for testing purposes
export { program };
