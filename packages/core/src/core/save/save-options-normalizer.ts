/**
 * Save Options Normalizer
 *
 * Validates, aliases, and defaults all save CLI options into a clean,
 * fully-typed structure for the pipeline. Called once at the CLI boundary.
 */

import type { SaveConflictStrategy } from './save-types.js';
import type { SaveToSourceOptions } from './save-to-source-pipeline.js';

export interface NormalizedSaveOptions {
  dryRun: boolean;
  conflicts: SaveConflictStrategy | undefined;
  prefer: string | undefined;
}

const VALID_STRATEGIES: ReadonlySet<string> = new Set(['newest', 'skip', 'auto']);

function validateSaveConflictStrategy(value: string | undefined): SaveConflictStrategy | undefined {
  if (value === undefined) return undefined;
  if (VALID_STRATEGIES.has(value)) return value as SaveConflictStrategy;
  throw new Error(
    `Invalid --conflicts strategy '${value}'. Valid values: ${[...VALID_STRATEGIES].join(', ')}`
  );
}

/**
 * Normalize save options at the CLI boundary.
 *
 * - Validates --conflicts
 * - Aliases --force → conflicts: 'newest'
 * - Passes through --prefer and --dry-run
 */
export function normalizeSaveOptions(
  options: SaveToSourceOptions & { conflicts?: string; json?: boolean }
): NormalizedSaveOptions {
  // Validate --conflicts strategy
  const explicitConflicts = validateSaveConflictStrategy(options.conflicts as string | undefined);

  // Resolve --force → conflicts: 'newest' aliasing
  let conflicts = explicitConflicts;
  if (!conflicts && options.force) {
    conflicts = 'newest';
  }

  // When --json is set and no explicit conflict strategy, default to 'auto'
  // to prevent interactive prompts from breaking JSON output
  if (options.json && !conflicts && !options.force) {
    conflicts = 'auto';
  }

  return {
    dryRun: options.dryRun ?? false,
    conflicts,
    prefer: options.prefer,
  };
}
