/**
 * Port Resolution Helpers
 * 
 * Utilities for resolving OutputPort and PromptPort from ExecutionContext,
 * falling back to safe defaults when ports are not explicitly provided.
 */

import type { ExecutionContext } from '../../types/execution-context.js';
import type { OutputPort } from './output.js';
import type { PromptPort } from './prompt.js';
import { consoleOutput } from './console-output.js';
import { nonInteractivePrompt } from './console-prompt.js';

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
