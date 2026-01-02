import { safePrompts } from '../../utils/prompts.js';
import { UserCancellationError } from '../../utils/errors.js';
import type { RemovalEntry } from './removal-collector.js';

export interface RemovalConfirmationOptions {
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Confirm removal operation with user.
 * 
 * @param packageName - Name of the package
 * @param entries - Files to be removed
 * @param options - Confirmation options
 * @returns true if user confirms, false otherwise
 * @throws UserCancellationError if user cancels
 */
export async function confirmRemoval(
  packageName: string,
  entries: RemovalEntry[],
  options: RemovalConfirmationOptions = {}
): Promise<boolean> {
  // Skip confirmation if force flag is set or dry-run
  if (options.force || options.dryRun) {
    return true;
  }

  console.log(`\nThe following ${entries.length} file${entries.length !== 1 ? 's' : ''} will be removed from '${packageName}':`);
  
  // Show up to 20 files, then summarize
  const maxDisplay = 20;
  const displayEntries = entries.slice(0, maxDisplay);
  
  for (const entry of displayEntries) {
    console.log(`  - ${entry.registryPath}`);
  }

  console.log('')
  
  if (entries.length > maxDisplay) {
    console.log(`  ... and ${entries.length - maxDisplay} more file${entries.length - maxDisplay !== 1 ? 's' : ''}`);
  }

  const response = await safePrompts({
    type: 'confirm',
    name: 'confirmed',
    message: 'Proceed with removal?',
    initial: false
  });

  if (!response.confirmed) {
    throw new UserCancellationError();
  }

  return true;
}
