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

import { log, spinner as clackSpinner } from '@clack/prompts';
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
   * Create a spinner with unified interface
   */
  spinner(): UnifiedSpinner {
    return createSpinner();
  }
};
