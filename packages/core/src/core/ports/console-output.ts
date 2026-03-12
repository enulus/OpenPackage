/**
 * Console Output Adapter (Default/CI)
 * 
 * Plain console.log-based implementation of OutputPort.
 * Used as the default fallback when no interactive UI is available.
 * Safe for CI/CD pipelines and headless environments.
 */

import type { OutputPort, UnifiedSpinner } from './output.js';

/**
 * Silent output adapter. All methods are no-ops.
 * Used to suppress spinner/info output during --json execution.
 */
export const silentOutput: OutputPort = {
  info(): void {},
  step(): void {},
  connector(): void {},
  message(): void {},
  success(): void {},
  error(): void {},
  warn(): void {},
  note(): void {},
  async confirm(): Promise<boolean> {
    return false;
  },
  spinner(): UnifiedSpinner {
    return {
      start() {},
      stop() {},
      message() {},
    };
  },
};

export const consoleOutput: OutputPort = {
  info(message: string): void {
    console.log(message);
  },

  step(message: string): void {
    console.log(message);
  },

  connector(): void {
    // No-op in plain console mode
  },

  message(message: string): void {
    console.log(message);
  },

  success(message: string): void {
    console.log(`✓ ${message}`);
  },

  error(message: string): void {
    console.log(`✗ ${message}`);
  },

  warn(message: string): void {
    console.log(`▲ ${message}`);
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
    // In non-interactive mode, return the default value
    return options?.initial ?? false;
  },

  spinner(): UnifiedSpinner {
    let msg = '';
    return {
      start(message: string) {
        msg = message;
        console.log(`… ${message}`);
      },
      stop(finalMessage?: string) {
        if (finalMessage) {
          console.log(`✓ ${finalMessage}`);
        } else {
          console.log(`✓ ${msg}`);
        }
      },
      message(text: string) {
        msg = text;
      },
    };
  },
};
