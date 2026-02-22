/**
 * Non-Interactive Prompt Adapter (Default/CI)
 * 
 * PromptPort implementation that throws on any prompt attempt.
 * Used in CI/CD pipelines and headless environments where
 * user interaction is not possible.
 */

import type { PromptPort, PromptChoice, PromptGroupChoices, TextPromptOptions } from './prompt.js';

export class NonInteractivePromptError extends Error {
  constructor(promptType: string) {
    super(
      `Cannot prompt for ${promptType} in non-interactive mode. ` +
      `Use specific flags or options to provide the required input.`
    );
    this.name = 'NonInteractivePromptError';
  }
}

export const nonInteractivePrompt: PromptPort = {
  async confirm(_message: string, _initial?: boolean): Promise<boolean> {
    throw new NonInteractivePromptError('confirmation');
  },

  async select<T>(_message: string, _choices: Array<PromptChoice<T>>, _hint?: string): Promise<T> {
    throw new NonInteractivePromptError('selection');
  },

  async multiselect<T>(_message: string, _choices: Array<PromptChoice<T>>): Promise<T[]> {
    throw new NonInteractivePromptError('multi-selection');
  },

  async groupMultiselect<T>(_message: string, _groups: PromptGroupChoices<T>): Promise<T[]> {
    throw new NonInteractivePromptError('group selection');
  },

  async text(_message: string, _options?: TextPromptOptions): Promise<string> {
    throw new NonInteractivePromptError('text input');
  },
};
