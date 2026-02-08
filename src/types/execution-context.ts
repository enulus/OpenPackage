/**
 * Execution Context Types
 * 
 * Type definitions for the execution context system that handles
 * directory resolution for commands with --global support.
 */

import type { TelemetryCollector } from '../utils/telemetry.js';

/**
 * ExecutionContext - Single source of truth for directory resolution
 * 
 * Strictly separates:
 * - sourceCwd: Where we resolve input arguments (local paths, relative paths)
 * - targetDir: Where we write output files (installation destination)
 */
export interface ExecutionContext {
  /**
   * Absolute path to the original working directory.
   * Used for resolving input arguments (e.g., ./package, ../local-plugin).
   */
  sourceCwd: string;
  
  /**
   * Absolute path to the target directory where files will be written.
   * - For normal commands: current working directory
   * - For --global commands: home directory
   * - For --cwd commands: specified directory
   */
  targetDir: string;
  
  /**
   * True if targetDir is the home directory.
   * Convenience flag for conditional logic and display.
   */
  isGlobal: boolean;
  
  /**
   * Optional telemetry collector for tracking install events.
   * When present, successful installations will report telemetry.
   */
  telemetryCollector?: TelemetryCollector;
}

/**
 * Options for creating an ExecutionContext
 */
export interface ExecutionOptions {
  /**
   * --global flag: Install to home directory
   */
  global?: boolean;
  
  /**
   * --cwd flag: Explicit target directory
   * (Ignored if global is true)
   */
  cwd?: string;
}

/**
 * Context variables exposed to platform flows and conditional logic
 */
export interface ContextVariables {
  /**
   * Normalized target path for display.
   * Shows as ~/ when targeting home directory.
   */
  $$targetRoot: string;
  
  /**
   * Original working directory for debugging.
   */
  $$sourceCwd: string;
  
  /**
   * Global flag for convenience in conditional logic.
   */
  $$isGlobal: boolean;
}
