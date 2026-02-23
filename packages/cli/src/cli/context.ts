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
import { createClackProgress, createPlainProgress } from './clack-progress-adapter.js';
import { nonInteractivePrompt } from '@opkg/core/core/ports/console-prompt.js';
import type { OutputPort } from '@opkg/core/core/ports/output.js';
import type { PromptPort } from '@opkg/core/core/ports/prompt.js';
import type { ProgressPort } from '@opkg/core/core/ports/progress.js';

export interface CliContextOptions extends ExecutionOptions {
  /** Override interactive mode detection (undefined = auto-detect from TTY) */
  interactive?: boolean;
  /**
   * Use clack-styled output (box-drawing characters, note boxes, clack spinners).
   * Defaults to `interactive` when set, otherwise `false`.
   * Prompt capability (clack select/confirm) is controlled separately by TTY detection.
   */
  interactiveOutput?: boolean;
}

/** Cached port singletons for the lifetime of the CLI process. */
let cachedClackOutput: OutputPort | undefined;
let cachedPlainOutput: OutputPort | undefined;
let cachedClackPrompt: PromptPort | undefined;
let cachedClackProgress: ProgressPort | undefined;
let cachedPlainProgress: ProgressPort | undefined;

function getCliPorts(opts: { interactiveOutput: boolean; interactivePrompts: boolean }) {
  const output = opts.interactiveOutput
    ? (cachedClackOutput ??= createClackOutput())
    : (cachedPlainOutput ??= createPlainOutput());

  const prompt = opts.interactivePrompts
    ? (cachedClackPrompt ??= createClackPrompt())
    : nonInteractivePrompt;

  const progress = opts.interactiveOutput
    ? (cachedClackProgress ??= createClackProgress())
    : (cachedPlainProgress ??= createPlainProgress());

  return { output, prompt, progress };
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
 * Output/progress formatting is plain by default (console.log with simple prefixes).
 * Clack-styled output (box-drawing characters, note boxes) is only used when
 * `interactive` or `interactiveOutput` is explicitly true.
 * 
 * Prompt capability (clack select/confirm) is determined by TTY detection,
 * independent of output formatting, so ambient prompts (platform selection,
 * marketplace plugin pick, etc.) still work on TTY even with plain output.
 */
export async function createCliExecutionContext(options: CliContextOptions = {}): Promise<ExecutionContext> {
  const ctx = await createExecutionContext(options);
  const isTTY = detectInteractive();
  const useClackOutput = options.interactiveOutput ?? options.interactive ?? false;
  const ports = getCliPorts({
    interactiveOutput: useClackOutput,
    interactivePrompts: isTTY,
  });

  ctx.output = ports.output;
  ctx.prompt = ports.prompt;
  ctx.progress = ports.progress;

  // When on TTY with plain default output, stash clack ports as rich ports
  // so core can temporarily upgrade output during prompt-driven phases
  // (e.g. marketplace selection, platform detection, ambiguity resolution).
  if (isTTY && !useClackOutput) {
    const richPorts = getCliPorts({ interactiveOutput: true, interactivePrompts: true });
    ctx.richOutput = richPorts.output;
    ctx.richProgress = richPorts.progress;
  }

  return ctx;
}

/**
 * Inject CLI ports into an existing ExecutionContext.
 * Useful when a context is created externally (e.g., scope-traversal)
 * but needs CLI output/prompt support.
 */
export function injectCliPorts(ctx: ExecutionContext, options?: { interactive?: boolean; interactiveOutput?: boolean }): ExecutionContext {
  const isTTY = detectInteractive();
  const useClackOutput = options?.interactiveOutput ?? options?.interactive ?? false;
  const ports = getCliPorts({
    interactiveOutput: useClackOutput,
    interactivePrompts: isTTY,
  });
  ctx.output ??= ports.output;
  ctx.prompt ??= ports.prompt;
  ctx.progress ??= ports.progress;

  if (isTTY && !useClackOutput) {
    const richPorts = getCliPorts({ interactiveOutput: true, interactivePrompts: true });
    ctx.richOutput ??= richPorts.output;
    ctx.richProgress ??= richPorts.progress;
  }

  return ctx;
}
