/**
 * CLI Context Factory
 * 
 * Creates ExecutionContext instances with CLI-specific port implementations
 * (Clack output adapter, Clack prompt adapter).
 * 
 * This is the CLI entry point for creating contexts -- command handlers
 * should use this instead of directly calling createExecutionContext()
 * to ensure ports are properly injected.
 */

import type { ExecutionContext, ExecutionOptions } from '@opkg/core/types/execution-context.js';
import { createExecutionContext } from '@opkg/core/core/execution-context.js';
import { createClackOutput, createPlainOutput } from './clack-output-adapter.js';
import { createClackPrompt } from './clack-prompt-adapter.js';
import { nonInteractivePrompt } from '@opkg/core/core/ports/console-prompt.js';
import type { OutputPort } from '@opkg/core/core/ports/output.js';
import type { PromptPort } from '@opkg/core/core/ports/prompt.js';

export interface CliContextOptions extends ExecutionOptions {
  /** Override interactive mode detection (undefined = auto-detect from TTY) */
  interactive?: boolean;
}

/** Cached port singletons for the lifetime of the CLI process. */
let cachedClackOutput: OutputPort | undefined;
let cachedPlainOutput: OutputPort | undefined;
let cachedClackPrompt: PromptPort | undefined;

function getCliPorts(isInteractive: boolean) {
  if (isInteractive) {
    cachedClackOutput ??= createClackOutput();
    cachedClackPrompt ??= createClackPrompt();
    return { output: cachedClackOutput, prompt: cachedClackPrompt };
  }
  cachedPlainOutput ??= createPlainOutput();
  return { output: cachedPlainOutput, prompt: nonInteractivePrompt };
}

/** Detect whether the current session is interactive (TTY, no CI). */
function detectInteractive(override?: boolean): boolean {
  if (override !== undefined) return override;
  const isTTY = process.stdin.isTTY === true;
  return isTTY && process.env.CI !== 'true';
}

/**
 * Create an ExecutionContext with CLI-specific ports injected.
 * 
 * In interactive mode (TTY): uses Clack for output and prompts.
 * In non-interactive mode (CI/piped): uses plain console output and throws on prompts.
 */
export async function createCliExecutionContext(options: CliContextOptions = {}): Promise<ExecutionContext> {
  const ctx = await createExecutionContext(options);
  const isInteractive = detectInteractive(options.interactive);
  const ports = getCliPorts(isInteractive);

  ctx.output = ports.output;
  ctx.prompt = ports.prompt;

  return ctx;
}

/**
 * Inject CLI ports into an existing ExecutionContext.
 * Useful when a context is created externally (e.g., scope-traversal)
 * but needs CLI output/prompt support.
 */
export function injectCliPorts(ctx: ExecutionContext, interactive?: boolean): ExecutionContext {
  const isInteractive = detectInteractive(interactive);
  const ports = getCliPorts(isInteractive);
  ctx.output ??= ports.output;
  ctx.prompt ??= ports.prompt;
  return ctx;
}
