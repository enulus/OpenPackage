/**
 * Ambiguity prompts for resource installation.
 * 
 * Handles user prompts when multiple patterns match at the same depth,
 * allowing users to select their preferred base directory.
 */

import { safePrompts } from '../../utils/prompts.js';
import { relative } from 'path';
import { logger } from '../../utils/logger.js';

/**
 * Base match option for user selection
 */
export interface BaseMatch {
  /** Base directory path (absolute) */
  base: string;
  
  /** Pattern that matched */
  pattern: string;
  
  /** Start index of the match */
  startIndex: number;
  
  /** Example target path for display */
  exampleTarget?: string;
}

/**
 * Prompt user to select a base when multiple patterns match.
 * 
 * @param resourcePath - The resource path that has ambiguous matches
 * @param matches - Array of possible base matches
 * @param repoRoot - Repository root for calculating relative paths
 * @returns Selected base match
 */
export async function promptBaseSelection(
  resourcePath: string,
  matches: BaseMatch[],
  repoRoot: string
): Promise<BaseMatch> {
  console.log(`\n❓ Multiple installation bases detected for '${resourcePath}':\n`);

  // Create choices for the prompt
  const choices = matches.map((match, i) => {
    const baseDisplay = match.base === repoRoot 
      ? '/ (repo root)' 
      : '/' + relative(repoRoot, match.base);
    
    return {
      title: `${i + 1}. Base: ${baseDisplay}`,
      description: `   Pattern: ${match.pattern}\n   ${match.exampleTarget ? 'Would install: ' + match.exampleTarget : ''}`,
      value: match
    };
  });

  // Add auto option (deepest match)
  choices.push({
    title: 'a. Auto (deepest match)',
    description: '   Select the most specific base automatically',
    value: null as any // Signal for auto-select
  });

  try {
    const response = await safePrompts({
      type: 'select',
      name: 'selection',
      message: 'Select base:',
      choices,
      initial: 0
    });

    if (response.selection === null) {
      // Auto-select deepest match
      const deepest = selectDeepestMatch(matches);
      logger.info('User selected auto (deepest match)', { base: deepest.base, pattern: deepest.pattern });
      return deepest;
    }

    logger.info('User selected base', { 
      base: response.selection.base, 
      pattern: response.selection.pattern 
    });
    return response.selection;
  } catch (error) {
    // On cancellation or error, fall back to deepest match
    logger.warn('Base selection cancelled or failed, using deepest match', { error });
    return selectDeepestMatch(matches);
  }
}

/**
 * Select the deepest match from an array of base matches.
 * The deepest match is the one with the highest startIndex.
 * 
 * @param matches - Array of base matches
 * @returns The deepest match
 */
function selectDeepestMatch(matches: BaseMatch[]): BaseMatch {
  if (matches.length === 0) {
    throw new Error('Cannot select deepest match from empty array');
  }

  if (matches.length === 1) {
    return matches[0];
  }

  // Find maximum start index
  const maxStartIndex = Math.max(...matches.map(m => m.startIndex));
  
  // Get first match at that depth (in case of ties)
  return matches.find(m => m.startIndex === maxStartIndex)!;
}

/**
 * Check if the current environment supports interactive prompts.
 * 
 * @returns True if interactive prompts are supported
 */
export function canPrompt(): boolean {
  // Check if stdin is a TTY (terminal)
  return process.stdin.isTTY === true;
}

/**
 * Handle ambiguity in non-interactive mode (--force or CI/CD).
 * Returns the deepest match without prompting.
 * 
 * @param matches - Array of ambiguous matches
 * @returns Selected base (deepest match)
 */
export function handleAmbiguityNonInteractive(matches: BaseMatch[]): BaseMatch {
  const selected = selectDeepestMatch(matches);
  
  logger.info('Non-interactive mode: using deepest match', {
    base: selected.base,
    pattern: selected.pattern,
    startIndex: selected.startIndex
  });

  // Log for debugging in CI/CD
  console.log(`ℹ️  Multiple bases detected. Using deepest match: ${selected.base}`);
  console.log(`   Pattern: ${selected.pattern}`);
  
  return selected;
}
