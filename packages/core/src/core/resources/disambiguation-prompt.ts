/**
 * Disambiguation Prompt
 *
 * Reusable "0/1/N" resolution pattern for resource and package name disambiguation.
 * - 0 candidates → throws ValidationError
 * - 1 candidate → returns it directly (no prompt)
 * - N candidates → shows multiselect prompt for user to choose
 */

import type { OutputPort } from '../ports/output.js';
import type { PromptPort } from '../ports/prompt.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { ValidationError } from '../../utils/errors.js';

export interface DisambiguationChoice<T> {
  title: string;
  description?: string;
  value: T;
}

export interface DisambiguationOptions {
  /** Message shown when no candidates found. Use ${name} as placeholder for the searched name. */
  notFoundMessage?: string;
  /** Header message shown above choices when multiple candidates found. Use ${name} placeholder. */
  ambiguousHeader?: string;
  /** Prompt message for the multiselect */
  promptMessage?: string;
  /** Whether to allow multiple selections (default: true) */
  multi?: boolean;
}

/**
 * Disambiguate among candidates using the 0/1/N pattern.
 *
 * @param name - The name that was searched for (used in messages)
 * @param candidates - Array of candidate items
 * @param formatChoice - Function to format each candidate as a prompt choice
 * @param options - Configuration options
 * @param output - Optional OutputPort
 * @param prompt - Optional PromptPort
 * @returns Array of selected candidates (single-element for 1 match or multi=false)
 */
export async function disambiguate<T>(
  name: string,
  candidates: T[],
  formatChoice: (candidate: T, index: number) => DisambiguationChoice<T>,
  options: DisambiguationOptions = {},
  output?: OutputPort,
  prompt?: PromptPort
): Promise<T[]> {
  const {
    notFoundMessage = `"${name}" not found.\nRun \`opkg ls\` to see installed resources.`,
    ambiguousHeader = `\n"${name}" matches multiple items:\n`,
    promptMessage = 'Select which to act on:',
    multi = true,
  } = options;

  const out = output ?? resolveOutput();
  const prm = prompt ?? resolvePrompt();

  // 0 candidates → error
  if (candidates.length === 0) {
    throw new ValidationError(
      notFoundMessage.replace(/\$\{name\}/g, name)
    );
  }

  // 1 candidate → auto-select
  if (candidates.length === 1) {
    return [candidates[0]];
  }

  // N candidates → prompt
  const choices = candidates.map((c, i) => {
    const choice = formatChoice(c, i);
    return {
      title: choice.title,
      description: choice.description,
      value: i,
    };
  });

  out.info(ambiguousHeader.replace(/\$\{name\}/g, name).trim());

  if (multi) {
    const selectedIndices = await prm.multiselect<number>(
      promptMessage,
      choices
    );

    if (!selectedIndices || selectedIndices.length === 0) {
      return [];
    }
    return selectedIndices.map(i => candidates[i]);
  } else {
    // Single select mode
    const selectedIndex = await prm.select<number>(
      promptMessage,
      choices
    );

    if (selectedIndex === null || selectedIndex === undefined) {
      return [];
    }
    return [candidates[selectedIndex]];
  }
}
