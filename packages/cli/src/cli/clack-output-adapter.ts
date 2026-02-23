/**
 * Clack Output Adapter
 * 
 * CLI-specific OutputPort implementation that routes to @clack/prompts
 * for rich interactive terminal UI. Falls back to plain console for
 * non-interactive sessions.
 * 
 * This is the CLI's implementation of the OutputPort interface defined
 * in core/ports/output.ts.
 */

import { log, spinner as clackSpinner, confirm as clackConfirm, note as clackNote, isCancel, cancel } from '@clack/prompts';
import { Spinner } from '../utils/spinner.js';
import type { OutputPort, UnifiedSpinner } from '@opkg/core/core/ports/output.js';

/**
 * Create a Clack-based OutputPort for interactive terminal sessions.
 */
export function createClackOutput(): OutputPort {
  return {
    info(message: string): void {
      log.info(message);
    },

    step(message: string): void {
      log.step(message);
    },

    connector(): void {
      log.message(' ', { spacing: 0 });
    },

    message(message: string): void {
      log.message(message, { spacing: 0 });
    },

    success(message: string): void {
      log.success(message);
    },

    error(message: string): void {
      log.error(message);
    },

    warn(message: string): void {
      log.warn(message);
    },

    note(content: string, title?: string): void {
      clackNote(content, title ?? '');
    },

    async confirm(message: string, options?: { initial?: boolean }): Promise<boolean> {
      const result = await clackConfirm({
        message,
        initialValue: options?.initial ?? false,
      });
      if (isCancel(result)) {
        cancel('Operation cancelled.');
        const { UserCancellationError } = await import('@opkg/core/utils/errors.js');
        throw new UserCancellationError('Operation cancelled by user');
      }
      return result as boolean;
    },

    spinner(): UnifiedSpinner {
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
        },
      };
    },
  };
}

/**
 * Create a plain console OutputPort for non-interactive sessions (CI, piped output).
 */
export function createPlainOutput(): OutputPort {
  return {
    info(message: string): void {
      console.log(message);
    },

    step(message: string): void {
      console.log(message);
    },

    connector(): void {
      // No-op in plain mode
    },

    message(message: string): void {
      console.log(message);
    },

    success(message: string): void {
      console.log(`✓ ${message}`);
    },

    error(message: string): void {
      console.log(`❌ ${message}`);
    },

    warn(message: string): void {
      console.log(`⚠️  ${message}`);
    },

    note(content: string, title?: string): void {
      const indented = content.split('\n').map(line => `  ${line}`).join('\n');
      if (title) {
        console.log(`\n${title}\n${indented}`);
      } else {
        console.log(`\n${indented}`);
      }
    },

    async confirm(_message: string, options?: { initial?: boolean }): Promise<boolean> {
      // In non-interactive/plain mode, return the default value.
      // There is no TTY to prompt the user, so we fall through silently.
      console.log(`${_message} ${options?.initial ? '(Y)' : '(N)'}`);
      return options?.initial ?? false;
    },

    spinner(): UnifiedSpinner {
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
        },
      };
    },
  };
}
