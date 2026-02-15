/**
 * Execution Context Module
 * 
 * Central module for all directory resolution logic.
 * Creates and validates ExecutionContext for commands.
 * 
 * This is the single source of truth for determining:
 * - Where to resolve input arguments (sourceCwd)
 * - Where to write output files (targetDir)
 */

import { resolve } from 'path';
import { stat, access, constants as fsConstants } from 'fs/promises';
import type { ExecutionContext, ExecutionOptions, ContextVariables } from '../types/execution-context.js';
import { getHomeDirectory, isHomeDirectory, normalizePathWithTilde } from '../utils/home-directory.js';
import { logger } from '../utils/logger.js';

/**
 * Create an ExecutionContext from command options.
 * 
 * Priority logic:
 * 1. If --global: targetDir = home directory
 * 2. Else if --cwd: targetDir = resolve(cwd)
 * 3. Else: targetDir = process.cwd()
 * 
 * sourceCwd is always process.cwd() (original working directory)
 * 
 * @param options - Command options (global, cwd flags)
 * @returns Validated ExecutionContext
 * @throws Error if validation fails
 */
export async function createExecutionContext(options: ExecutionOptions = {}): Promise<ExecutionContext> {
  // sourceCwd is always the original working directory
  const sourceCwd = process.cwd();
  
  // Determine targetDir based on options
  let targetDir: string;
  let isGlobal: boolean;
  
  if (options.global) {
    targetDir = getHomeDirectory();
    isGlobal = true;
    
    // Log warning if both flags present
    if (options.cwd) {
      logger.info('--global option present, ignoring --cwd', { 
        cwd: options.cwd,
        targetDir 
      });
    }
  } else if (options.cwd) {
    targetDir = resolve(sourceCwd, options.cwd);
    isGlobal = isHomeDirectory(targetDir);
  } else {
    targetDir = sourceCwd;
    isGlobal = isHomeDirectory(targetDir);
  }
  
  // Create context
  const context: ExecutionContext = {
    sourceCwd,
    targetDir,
    isGlobal,
    interactive: options.interactive
  };
  
  // Validate context
  await validateExecutionContext(context);
  
  // Log context creation
  logger.debug('Created execution context', {
    sourceCwd: context.sourceCwd,
    targetDir: context.targetDir,
    isGlobal: context.isGlobal
  });
  
  return context;
}

/**
 * Validate an ExecutionContext.
 * 
 * Checks:
 * - targetDir exists and is a directory
 * - targetDir is writable
 * - sourceCwd exists and is readable
 * 
 * @param context - ExecutionContext to validate
 * @throws Error with helpful message if validation fails
 */
async function validateExecutionContext(context: ExecutionContext): Promise<void> {
  // Validate targetDir
  try {
    const targetStat = await stat(context.targetDir);
    if (!targetStat.isDirectory()) {
      throw new Error(`Target path is not a directory: ${context.targetDir}`);
    }
    
    // Check if writable
    await access(context.targetDir, fsConstants.W_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Target directory does not exist: ${context.targetDir}\n\n` +
        `Hint: Create the directory or specify a different target with --cwd`
      );
    }
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      throw new Error(
        `Target directory is not writable: ${context.targetDir}\n\n` +
        `Hint: Check directory permissions`
      );
    }
    throw new Error(
      `Invalid target directory: ${context.targetDir}\n` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  
  // Validate sourceCwd
  try {
    const sourceStat = await stat(context.sourceCwd);
    if (!sourceStat.isDirectory()) {
      throw new Error(`Source working directory is not a directory: ${context.sourceCwd}`);
    }
    
    // Check if readable
    await access(context.sourceCwd, fsConstants.R_OK);
  } catch (error) {
    throw new Error(
      `Invalid source working directory: ${context.sourceCwd}\n` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate context variables for platform flows and conditional logic.
 * 
 * Variables:
 * - $$targetRoot: Normalized target path (with ~/ if home)
 * - $$sourceCwd: Original working directory
 * - $$isGlobal: Global flag for convenience
 * 
 * @param context - ExecutionContext
 * @returns Map of context variables
 */
export function getContextVariables(context: ExecutionContext): ContextVariables {
  return {
    $$targetRoot: normalizePathWithTilde(context.targetDir),
    $$sourceCwd: context.sourceCwd,
    $$isGlobal: context.isGlobal
  };
}

/**
 * Get display-friendly target directory path.
 * Shows ~/ for home directory.
 * 
 * @param context - ExecutionContext
 * @returns Display-friendly path
 */
export function getDisplayTargetDir(context: ExecutionContext): string {
  return normalizePathWithTilde(context.targetDir);
}
