/**
 * Shared collection utilities.
 */

/** Deduplicate and sort a string array. */
export function sortAndDedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
