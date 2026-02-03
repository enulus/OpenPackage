import type { ConvenienceFilterOptions, ResourceInstallationSpec } from '../convenience-matchers.js';
import { applyConvenienceFilters, displayFilterErrors } from '../convenience-matchers.js';

/**
 * Resolve convenience resources (agents/skills) to install.
 *
 * This centralizes user-facing error display and "continue with partial matches"
 * behavior so strategies/handlers don't duplicate it.
 *
 * @throws Error if none of the requested resources can be found.
 */
export async function resolveConvenienceResources(
  basePath: string,
  repoRoot: string,
  options: ConvenienceFilterOptions
): Promise<ResourceInstallationSpec[]> {
  const filterResult = await applyConvenienceFilters(basePath, repoRoot, options);

  if (filterResult.errors.length > 0) {
    displayFilterErrors(filterResult.errors);

    if (filterResult.resources.length === 0) {
      throw new Error('None of the requested resources were found');
    }

    console.log(`\n⚠️  Continuing with ${filterResult.resources.length} resource(s)\n`);
  }

  return filterResult.resources;
}
