/**
 * Clack Prompt Wrappers
 * 
 * Consistent wrappers around @clack/prompts for common prompt patterns.
 * Provides simplified API with automatic cancellation handling.
 */

import { multiselect, select, isCancel } from '@clack/prompts';

/**
 * Option for clack prompts
 */
export interface ClackOption<T> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Display a multiselect prompt using @clack/prompts.
 * 
 * @param message - The prompt message to display
 * @param options - Array of options to select from
 * @returns Array of selected values, or null if cancelled
 */
export async function clackMultiselect<T>(
  message: string,
  options: ClackOption<T>[]
): Promise<T[] | null> {
  const result = await multiselect({
    message,
    options: options as any // Type assertion needed for complex generic types
  });
  
  if (isCancel(result)) {
    return null;
  }
  
  return result as T[];
}

/**
 * Display a select prompt using @clack/prompts.
 * 
 * @param message - The prompt message to display
 * @param options - Array of options to select from
 * @returns Selected value, or null if cancelled
 */
export async function clackSelect<T>(
  message: string,
  options: ClackOption<T>[]
): Promise<T | null> {
  const result = await select({
    message,
    options: options as any // Type assertion needed for complex generic types
  });
  
  if (isCancel(result)) {
    return null;
  }
  
  return result as T;
}
