/**
 * Sync Options Normalizer
 *
 * Validates, aliases, and defaults all sync CLI options into a clean,
 * fully-typed structure for the pipeline. Called once at the CLI boundary.
 */

import type { SyncConflictStrategy, SyncDirection, SyncOptions } from './sync-types.js';

const VALID_STRATEGIES: ReadonlySet<string> = new Set(['workspace', 'source', 'skip', 'auto']);

function validateConflictStrategy(value: string | undefined): SyncConflictStrategy | undefined {
  if (value === undefined) return undefined;
  if (VALID_STRATEGIES.has(value)) return value as SyncConflictStrategy;
  throw new Error(
    `Invalid --conflicts strategy '${value}'. Valid values: ${[...VALID_STRATEGIES].join(', ')}`
  );
}

/**
 * Normalize sync options at the CLI boundary.
 *
 * - `--push` + `--pull` or neither → bidirectional
 * - `--force` → conflicts: 'workspace'
 * - `--json` without explicit conflicts → conflicts: 'auto'
 * - Validates --conflicts values
 */
export function normalizeSyncOptions(raw: {
  push?: boolean;
  pull?: boolean;
  force?: boolean;
  conflicts?: string;
  dryRun?: boolean;
  json?: boolean;
  platforms?: string[];
  prefer?: string;
  global?: boolean;
  versionOverride?: string;
}): SyncOptions {
  // Determine direction
  let direction: SyncDirection;
  if (raw.push && !raw.pull) {
    direction = 'push';
  } else if (raw.pull && !raw.push) {
    direction = 'pull';
  } else {
    direction = 'bidirectional';
  }

  // Validate --conflicts strategy
  const explicitConflicts = validateConflictStrategy(raw.conflicts);

  // Resolve --force → conflicts: 'workspace' aliasing
  let conflicts = explicitConflicts;
  if (!conflicts && raw.force) {
    conflicts = 'workspace';
  }

  // When --json is set and no explicit conflict strategy, default to 'auto'
  // to prevent interactive prompts from breaking JSON output
  if (raw.json && !conflicts && !raw.force) {
    conflicts = 'auto';
  }

  return {
    direction,
    dryRun: raw.dryRun ?? false,
    conflicts,
    platforms: raw.platforms,
    prefer: raw.prefer,
    versionOverride: raw.versionOverride,
    force: raw.force ?? false,
  };
}
