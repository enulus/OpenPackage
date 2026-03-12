/**
 * Sync Version Resolver
 *
 * Interactive version mismatch resolution for human mode.
 * Mirrors sync-conflict-resolver.ts structure.
 */

import type { PromptPort } from '../ports/prompt.js';
import type { VersionCheckResult } from './sync-version-checker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VersionResolution =
  | { action: 'update'; newRange: string }
  | { action: 'skip' };

// ---------------------------------------------------------------------------
// Interactive resolver
// ---------------------------------------------------------------------------

/**
 * Prompt the user to resolve a version mismatch interactively.
 *
 * Offers three choices:
 * 1. Update manifest to suggested caret range
 * 2. Enter a custom range
 * 3. Skip (abort sync for this package)
 */
export async function resolveVersionMismatchInteractively(
  packageName: string,
  check: VersionCheckResult,
  prompt: PromptPort,
): Promise<VersionResolution> {
  const suggested = check.suggestedRange ?? `^${check.sourceVersion}`;

  const choice = await prompt.select<'update' | 'custom' | 'skip'>(
    `Version mismatch for ${packageName}: source is ${check.sourceVersion} but manifest requires ${check.manifestRange}`,
    [
      { title: `Update manifest range to ${suggested}`, value: 'update' },
      { title: 'Enter a custom version range', value: 'custom' },
      { title: 'Skip this package', value: 'skip' },
    ],
  );

  if (choice === 'update') {
    return { action: 'update', newRange: suggested };
  }

  if (choice === 'custom') {
    const customRange = await prompt.text('Enter version range:', {
      placeholder: suggested,
      initial: suggested,
    });
    return { action: 'update', newRange: customRange };
  }

  return { action: 'skip' };
}
