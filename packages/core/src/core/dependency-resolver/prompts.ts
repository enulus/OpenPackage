/**
 * Prompt utilities for dependency resolution.
 */

import type { PromptPort } from '../ports/prompt.js';
import { resolvePrompt } from '../ports/resolve.js';

/**
 * Prompt user for overwrite confirmation
 */
export async function promptOverwrite(
  packageName: string, 
  existingVersion: string, 
  newVersion: string,
  prompt?: PromptPort
): Promise<boolean> {
  const p = prompt ?? resolvePrompt();
  return p.confirm(
    `Package '${packageName}' conflict: existing v${existingVersion} vs required v${newVersion}. Overwrite with v${newVersion}?`,
    true
  );
}
