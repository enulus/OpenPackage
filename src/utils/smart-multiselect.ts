/**
 * Smart Multiselect Prompt
 * 
 * Wrapper around prompts multiselect that expands category selections
 * Note: Real-time category toggling isn't possible with the prompts library,
 * so we expand category selections after the user confirms.
 */

import prompts from 'prompts';

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
  try {
    const response = await prompts(
      {
        type: 'multiselect',
        name: 'selectedIndices',
        message,
        choices,
        hint: options?.hint,
        min: options?.min,
        instructions: false
      },
      {
        onCancel: () => {
          throw new Error('USER_CANCELLED');
        }
      }
    );
    
    const selectedIndices = response.selectedIndices || [];
    
    // Expand category selections to include all their resources
    return expandCategorySelections(selectedIndices, categoryMap);
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_CANCELLED') {
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
