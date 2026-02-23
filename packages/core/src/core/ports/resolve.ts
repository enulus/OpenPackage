/**
 * Port Resolution Helpers
 * 
 * Utilities for resolving OutputPort, PromptPort, and ProgressPort from
 * ExecutionContext, falling back to safe defaults when ports are not
 * explicitly provided.
 */

import type { ExecutionContext } from '../../types/execution-context.js';
import type { OutputPort } from './output.js';
import type { PromptPort } from './prompt.js';
import type { ProgressPort } from './progress.js';
import { consoleOutput } from './console-output.js';
import { nonInteractivePrompt } from './console-prompt.js';
import { silentProgress } from './console-progress.js';

/**
 * Resolve the OutputPort from an ExecutionContext.
 * Falls back to consoleOutput (plain console.log) if not provided.
 */
export function resolveOutput(ctx?: ExecutionContext | { output?: OutputPort }): OutputPort {
  return ctx?.output ?? consoleOutput;
}

/**
 * Resolve the PromptPort from an ExecutionContext.
 * Falls back to nonInteractivePrompt (throws on any prompt) if not provided.
 */
export function resolvePrompt(ctx?: ExecutionContext | { prompt?: PromptPort }): PromptPort {
  return ctx?.prompt ?? nonInteractivePrompt;
}

/**
 * Resolve the ProgressPort from an ExecutionContext.
 * Falls back to silentProgress (no-op) if not provided.
 * 
 * The default is silent (not consoleProgress) because progress events
 * are opt-in: the CLI adapter or GUI adapter must explicitly subscribe.
 * This prevents noisy [progress] logs in CI/CD unless explicitly requested.
 */
export function resolveProgress(ctx?: ExecutionContext | { progress?: ProgressPort }): ProgressPort {
  return ctx?.progress ?? silentProgress;
}

/**
 * Run a callback with rich output/progress ports temporarily active on
 * the ExecutionContext. Restores the original ports after the callback
 * completes (or throws).
 *
 * Use this around prompt-driven phases (marketplace selection, platform
 * detection, ambiguity resolution, conflict confirmation) so that
 * prompt rendering is visually consistent with surrounding output.
 *
 * If rich ports are not available (e.g. non-CLI environment or already
 * using rich output), the callback runs with the existing ports unchanged.
 */
export async function withRichOutput<T>(
  ctx: ExecutionContext,
  fn: () => Promise<T>
): Promise<T> {
  if (!ctx.richOutput) {
    // No rich ports available -- run with current ports unchanged
    return fn();
  }
  const prev = { output: ctx.output, progress: ctx.progress };
  ctx.output = ctx.richOutput;
  ctx.progress = ctx.richProgress ?? ctx.progress;
  try {
    return await fn();
  } finally {
    ctx.output = prev.output;
    ctx.progress = prev.progress;
  }
}
