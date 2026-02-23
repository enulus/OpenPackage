/**
 * Execution Context Types
 * 
 * Type definitions for the execution context system that handles
 * directory resolution for commands with --global support.
 */

import type { TelemetryCollector } from '../core/telemetry.js';
import type { InteractionPolicy } from '../core/interaction-policy.js';
import type { OutputPort } from '../core/ports/output.js';
import type { PromptPort } from '../core/ports/prompt.js';
import type { ProgressPort } from '../core/ports/progress.js';

/**
 * ExecutionContext - Single source of truth for directory resolution
 * 
 * Strictly separates:
 * - sourceCwd: Where we resolve input arguments (local paths, relative paths)
 * - targetDir: Where we write output files (installation destination)
 * 
 * Also carries port interfaces for decoupled output and prompting,
 * enabling the same core logic to be driven by CLI, GUI, or CI.
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
  
  /**
   * Indicates interactive mode (--interactive).
   * When true, suppress detailed output to keep the interface clean.
   */
  interactive?: boolean;
  
  /**
   * Interaction policy controlling prompt behavior across all tiers.
   * Created once at command entry and threaded through all handlers.
   */
  interactionPolicy?: InteractionPolicy;

  /**
   * Output port for all user-facing messages (info, success, error, warn, etc.).
   * When not provided, defaults to consoleOutput (plain console.log).
   * CLI provides ClackOutputAdapter; GUI provides its own adapter.
   */
  output?: OutputPort;

  /**
   * Prompt port for all interactive user prompts (confirm, select, text, etc.).
   * When not provided, defaults to nonInteractivePrompt (throws on prompt).
   * CLI provides ClackPromptAdapter; GUI provides its own adapter.
   */
  prompt?: PromptPort;

  /**
   * Progress port for streaming structured progress events to the UI.
   * When not provided, defaults to silentProgress (no-op).
   * CLI provides ClackProgressAdapter; GUI provides its own adapter.
   */
  progress?: ProgressPort;

  /**
   * Rich output port for use during prompt-driven phases.
   * When prompts fire, surrounding output should match their visual style.
   * Use `withRichOutput()` to temporarily swap to these ports.
   * Set by the CLI (or other UI adapter) at context creation; undefined when not available.
   */
  richOutput?: OutputPort;

  /**
   * Rich progress port, paired with richOutput.
   */
  richProgress?: ProgressPort;
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
  
  /**
   * Indicates interactive mode (--interactive).
   * When true, commands should operate in interactive selection mode.
   */
  interactive?: boolean;
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
