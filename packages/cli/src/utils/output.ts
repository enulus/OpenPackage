/**
 * Unified output abstraction for interactive vs non-interactive flows.
 * 
 * This module provides a consistent API for output that automatically
 * routes to either clack (interactive UI) or plain console output based
 * on the current mode.
 * 
 * Usage:
 *   setOutputMode(true);  // Enable interactive mode (clack UI)
 *   output.info('Hello'); // Uses clack in interactive, console.log in non-interactive
 */

import { log, spinner as clackSpinner, confirm as clackConfirm, note as clackNote, isCancel, cancel } from '@clack/prompts';
import { Spinner } from './spinner.js';

/**
 * Current output mode
 */
let isInteractiveMode = false;

/**
 * Set the output mode for all subsequent output calls.
 * Should be called once at the start of a command flow.
 * 
 * @param interactive - True for interactive mode (clack UI), false for plain output
 */
export function setOutputMode(interactive: boolean): void {
  isInteractiveMode = interactive;
}

/**
 * Get the current output mode
 */
export function isInteractive(): boolean {
  return isInteractiveMode;
}

/**
 * Unified spinner interface that works in both modes
 */
export interface UnifiedSpinner {
  start(message: string): void;
  stop(finalMessage?: string): void;
  message(text: string): void;
}

/**
 * Create a spinner that works in both interactive and non-interactive modes.
 * 
 * @returns Unified spinner interface (call .start() to begin)
 */
function createSpinner(): UnifiedSpinner {
  if (isInteractiveMode) {
    // Use clack spinner for interactive mode
    const s = clackSpinner();
    let isStarted = false;
    
    return {
      start(message: string) {
        if (!isStarted) {
          s.start(message);
          isStarted = true;
        }
      },
      stop(finalMessage?: string) {
        if (isStarted) {
          if (finalMessage) {
            s.stop(finalMessage);
          } else {
            s.stop();
          }
          isStarted = false;
        }
      },
      message(text: string) {
        if (isStarted) {
          s.message(text);
        }
      }
    };
  } else {
    // Use custom Spinner for non-interactive mode
    let s: Spinner | null = null;
    
    return {
      start(message: string) {
        s = new Spinner(message);
        s.start();
      },
      stop(finalMessage?: string) {
        if (s) {
          s.stop();
          if (finalMessage) {
            console.log(finalMessage);
          }
          s = null;
        }
      },
      message(text: string) {
        if (s) {
          s.update(text);
        }
      }
    };
  }
}

/**
 * Unified output API
 */
export const output = {
  /**
   * Display an informational message
   */
  info(message: string): void {
    if (isInteractiveMode) {
      log.info(message);
    } else {
      console.log(message);
    }
  },

  /**
   * Display a step message (diamond symbol, for package header before Selected)
   */
  step(message: string): void {
    if (isInteractiveMode) {
      log.step(message);
    } else {
      console.log(message);
    }
  },

  /**
   * Add single connecting line between package header and Selected section.
   * Uses spacing: 0 to avoid extra blank lines.
   */
  connector(): void {
    if (isInteractiveMode) {
      log.message(' ', { spacing: 0 });
    }
  },

  /**
   * Display a regular message
   */
  message(message: string): void {
    if (isInteractiveMode) {
      log.message(message);
    } else {
      console.log(message);
    }
  },

  /**
   * Display a success message
   */
  success(message: string): void {
    if (isInteractiveMode) {
      log.success(message);
    } else {
      console.log(`✓ ${message}`);
    }
  },

  /**
   * Display an error message
   */
  error(message: string): void {
    if (isInteractiveMode) {
      log.error(message);
    } else {
      console.log(`❌ ${message}`);
    }
  },

  /**
   * Display a warning message
   */
  warn(message: string): void {
    if (isInteractiveMode) {
      log.warn(message);
    } else {
      console.log(`⚠️  ${message}`);
    }
  },

  /**
   * Display a note block (title + content). In interactive mode uses clack's note.
   */
  note(content: string, title?: string): void {
    if (isInteractiveMode) {
      clackNote(content, title ?? '');
    } else {
      if (title) {
        console.log(`\n${title}\n${content}`);
      } else {
        console.log(`\n${content}`);
      }
    }
  },

  /**
   * Prompt for confirmation. In interactive mode uses clack's confirm.
   * @throws UserCancellationError when user cancels (Ctrl+C)
   */
  async confirm(message: string, options?: { initial?: boolean }): Promise<boolean> {
    if (isInteractiveMode) {
      const result = await clackConfirm({
        message,
        initialValue: options?.initial ?? false
      });
      if (isCancel(result)) {
        cancel('Operation cancelled.');
        const { UserCancellationError } = await import('@opkg/core/utils/errors.js');
        throw new UserCancellationError('Operation cancelled by user');
      }
      return result as boolean;
    }
    // In non-interactive mode, return the default value.
    // There is no TTY to prompt the user, so we fall through silently.
    console.log(`${message} ${options?.initial ? '(Y)' : '(N)'}`);
    return options?.initial ?? false;
  },

  /**
   * Create a spinner with unified interface
   */
  spinner(): UnifiedSpinner {
    return createSpinner();
  }
};
