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
import type { IndexWriteCollector } from '../core/install/wave-resolver/index-write-collector.js';
import type { OwnershipContext } from '../core/install/conflicts/file-conflict-resolver.js';

/**
 * Output mode for the current session.
 *
 * Committed once at command entry (or after install preprocessing).
 * Controls which port adapters are active for the lifetime of the command.
 *
 * - `'rich'`  – Clack output + Clack prompts + Clack spinners (box-drawing UI)
 * - `'plain'` – Plain console output + readline prompts + braille spinners
 */
export type OutputMode = 'rich' | 'plain';

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
   * CLI provides ClackOutputAdapter or PlainOutputAdapter based on outputMode.
   */
  output?: OutputPort;

  /**
   * Prompt port for all interactive user prompts (confirm, select, text, etc.).
   * When not provided, defaults to nonInteractivePrompt (throws on prompt).
   * CLI provides ClackPromptAdapter (rich) or PlainPromptAdapter (plain) based on outputMode.
   */
  prompt?: PromptPort;

  /**
   * Progress port for streaming structured progress events to the UI.
   * When not provided, defaults to silentProgress (no-op).
   * CLI provides ClackProgressAdapter or PlainProgressAdapter based on outputMode.
   */
  progress?: ProgressPort;

  /**
   * The committed output mode for this session.
   * Set once at command entry or after install preprocessing (via commitOutputMode).
   * Once set, all ports are locked to this mode for the lifetime of the command.
   */
  outputMode?: OutputMode;

  /**
   * Callback to finalize the output mode after command preprocessing.
   * Set by the CLI adapter at context creation. Called by core code
   * (e.g. the install orchestrator) when the flow type is determined.
   *
   * This is a one-shot operation: calling it when outputMode is already
   * set to the requested mode is a no-op.
   */
   commitOutputMode?: (mode: OutputMode) => void;

  /**
   * When present, workspace index writes are deferred to this collector
   * instead of being written to disk immediately. Used during parallel
   * wave-based installations to prevent read-modify-write races on
   * openpackage.index.yml.
   */
  indexWriteCollector?: IndexWriteCollector;

  /**
   * Pre-built ownership context shared across parallel installs within a wave.
   * When present, the flow-based strategy skips building its own context and
   * uses this one instead. Prevents stale reads when multiple packages install
   * concurrently.
   */
  sharedOwnershipContext?: OwnershipContext;
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
