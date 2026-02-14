#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from './utils/logger.js';
import * as path from 'path';
import fs from 'fs/promises';
import { constants } from 'fs';
import { ensureOpenPackageDirectories } from './core/directory.js';
import { getVersion } from './utils/package.js';

// Import command setup functions
import { setupNewCommand } from './commands/new.js';
import { setupAddCommand } from './commands/add.js';
import { setupRemoveCommand } from './commands/remove.js';
import { setupSaveCommand } from './commands/save.js';
import { setupInstallCommand } from './commands/install.js';
import { setupUninstallCommand } from './commands/uninstall.js';
import { setupListCommand } from './commands/list.js';
import { setupSearchCommand } from './commands/search.js';

import { setupPackCommand } from './commands/pack.js';
import { setupPublishCommand } from './commands/publish.js';
import { setupConfigureCommand } from './commands/configure.js';
import { setupLoginCommand } from './commands/login.js';
import { setupLogoutCommand } from './commands/logout.js';
import { setupSetCommand } from './commands/set.js';

/**
 * OpenPackage CLI - Main entry point
 * 
 * A scalable command-line tool for packaging AI coding files.
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
      output += '    install, uninstall, list, search,\n';
      output += '    new, add, remove, save, set, pack, publish,\n';
      output += '    login, logout\n\n';
      
      // Version
      const version = cmd.version();
      if (version) {
        output += `opkg@${version}\n`;
      }
      
      return output;
    }
  });

// === FORMULA APPLICATION COMMANDS ===
setupNewCommand(program);
setupAddCommand(program);
setupRemoveCommand(program);
setupSaveCommand(program);
setupSetCommand(program);
setupInstallCommand(program);
setupUninstallCommand(program);
setupListCommand(program);
setupSearchCommand(program);
setupPackCommand(program);
setupPublishCommand(program);

// === CONFIGURATION ===
setupConfigureCommand(program);
setupLoginCommand(program);
setupLogoutCommand(program);

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
      console.error(`❌ Invalid --cwd '${opts.cwd}': Directory must exist, be accessible, and writable. Details: ${errMsg}`);
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
  console.error('❌ An unexpected error occurred. Please check the logs for details.');
  process.exit(1);
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  console.error('❌ An unexpected error occurred. Please check the logs for details.');
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
    console.error('❌ Failed to initialize OpenPackage directories. Please check permissions.');
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
    console.error('❌ Command execution failed. Use --help for usage information.');
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
    console.error('❌ Fatal error occurred. Exiting.');
    process.exit(1);
  });
}

// Export the program for testing purposes
export { program };