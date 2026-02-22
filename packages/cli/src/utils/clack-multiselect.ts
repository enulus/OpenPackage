/**
 * Clack Group Multiselect Wrapper
 * 
 * Wrapper around @clack/prompts groupMultiselect
 * for resource selection in install --interactive command.
 */

import { groupMultiselect, isCancel } from '@clack/prompts';

/**
 * Option for clack group multiselect
 */
export interface ClackMultiselectOption<T> {
  value: T;
  label?: string;
  hint?: string;
}

/**
 * Options for clack group multiselect
 */
export interface ClackGroupMultiselectOptions {
  /**
   * Whether top-level groups can be selected.
   * When true, selecting a group selects all items in that group.
   * @default true
   */
  selectableGroups?: boolean;
  
  /**
   * Number of blank lines between groups.
   * @default 0
   */
  groupSpacing?: number;
}

/**
 * Display a grouped multiselect prompt using @clack/prompts.
 * 
 * @param message - The prompt message to display
 * @param groupedOptions - Options grouped by category
 * @param options - Additional options for the prompt
 * @returns Array of selected values, or null if cancelled
 */
export async function clackGroupMultiselect<T>(
  message: string,
  groupedOptions: Record<string, ClackMultiselectOption<T>[]>,
  options?: ClackGroupMultiselectOptions
): Promise<T[] | null> {
  // Prepare options for @clack/prompts format
  // Note: For non-primitive types, label is required
  const clackOptions: Record<string, Array<{
    value: T;
    label: string;
    hint?: string;
  }>> = {};
  
  for (const [groupName, items] of Object.entries(groupedOptions)) {
    clackOptions[groupName] = items.map(item => ({
      value: item.value,
      label: item.label || String(item.value), // Ensure label is always provided
      hint: item.hint
    }));
  }
  
  // Call groupMultiselect with type assertion
  // TypeScript can't infer that T is non-primitive and requires label
  const result = await groupMultiselect({
    message,
    options: clackOptions as any, // Type assertion needed for complex generic types
    selectableGroups: options?.selectableGroups ?? true,
    groupSpacing: options?.groupSpacing ?? 0
  });
  
  // Check for cancellation
  if (isCancel(result)) {
    return null;
  }
  
  // Return selected values
  return result as T[];
}
