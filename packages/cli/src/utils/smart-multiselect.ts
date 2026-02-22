/**
 * Smart Multiselect Prompt
 * 
 * Wrapper around @clack/prompts multiselect that expands category selections.
 * Note: Real-time category toggling isn't possible with clack's multiselect,
 * so we expand category selections after the user confirms.
 */

import * as clack from '@clack/prompts';
import { UserCancellationError } from '@opkg/core/utils/errors.js';

/**
 * Create a multiselect prompt with category expansion support
 * 
 * Categories can be selected, and will automatically expand to include all items
 * when the user confirms their selection.
 */
export async function smartMultiselect(
  message: string,
  choices: any[],
  categoryMap: Map<number, number[]>,
  options?: {
    hint?: string;
    min?: number;
  }
): Promise<number[]> {
  const clackOptions = choices.map((c: any) => ({
    label: c.title ?? c.label ?? String(c.value),
    value: c.value as number,
    hint: c.description ?? c.hint,
  }));

  try {
    const result = await clack.multiselect({
      message,
      options: clackOptions,
      required: options?.min ? options.min > 0 : false,
    });

    if (clack.isCancel(result)) {
      return [];
    }

    const selectedIndices = (result as number[]) || [];

    // Expand category selections to include all their resources
    return expandCategorySelections(selectedIndices, categoryMap);
  } catch (error) {
    if (error instanceof UserCancellationError) {
      return [];
    }
    throw error;
  }
}

/**
 * Expand category selections to include all resources in those categories
 */
function expandCategorySelections(
  selectedIndices: number[],
  categoryMap: Map<number, number[]>
): number[] {
  const expanded = new Set<number>();
  
  for (const index of selectedIndices) {
    // Check if this is a category index (negative)
    if (index < 0 && categoryMap.has(index)) {
      // Get all resource indices for this category
      const resourceIndices = categoryMap.get(index)!;
      resourceIndices.forEach(resIdx => expanded.add(resIdx));
    } else if (index >= 0) {
      // Regular resource selection
      expanded.add(index);
    }
  }
  
  return Array.from(expanded).sort((a, b) => a - b);
}
