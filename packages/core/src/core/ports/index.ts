/**
 * Core Ports
 * 
 * Re-exports all port interfaces and default implementations.
 * These ports define the boundary between core business logic
 * and external concerns (UI, I/O, etc.).
 */

export type { OutputPort, UnifiedSpinner } from './output.js';
export type { PromptPort, PromptChoice, PromptGroupChoices, TextPromptOptions } from './prompt.js';
export { consoleOutput } from './console-output.js';
export { nonInteractivePrompt, NonInteractivePromptError } from './console-prompt.js';
export { resolveOutput, resolvePrompt } from './resolve.js';
