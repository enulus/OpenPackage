/**
 * Output Port Interface
 * 
 * Defines the contract for all user-facing output operations.
 * Core logic uses this interface instead of console.log or @clack/prompts directly.
 * 
 * Implementations:
 *   - ClackOutputAdapter (CLI): routes to @clack/prompts for rich terminal UI
 *   - ConsoleOutputAdapter (default/CI): routes to plain console.log
 *   - GUI adapter (Tauri): routes to frontend via IPC
 */

/**
 * Unified spinner interface that works across all output backends.
 */
export interface UnifiedSpinner {
  start(message: string): void;
  stop(finalMessage?: string): void;
  message(text: string): void;
}

/**
 * OutputPort defines all user-facing output operations.
 * 
 * This is the primary abstraction that decouples core business logic
 * from any specific rendering backend (terminal, GUI, etc.).
 */
export interface OutputPort {
  /** Display an informational message */
  info(message: string): void;

  /** Display a step/progress indicator */
  step(message: string): void;

  /** Add a visual connector between output sections */
  connector(): void;

  /** Display a plain message */
  message(message: string): void;

  /** Display a success message */
  success(message: string): void;

  /** Display an error message */
  error(message: string): void;

  /** Display a warning message */
  warn(message: string): void;

  /** Display a note block with optional title */
  note(content: string, title?: string): void;

  /** Prompt for a yes/no confirmation */
  confirm(message: string, options?: { initial?: boolean }): Promise<boolean>;

  /** Create a spinner for long-running operations */
  spinner(): UnifiedSpinner;
}
