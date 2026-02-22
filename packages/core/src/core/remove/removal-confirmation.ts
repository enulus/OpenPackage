import { UserCancellationError } from '../../utils/errors.js';
import type { RemovalEntry } from './removal-collector.js';
import { PromptTier } from '../../core/interaction-policy.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

export interface RemovalConfirmationOptions {
  force?: boolean;
  dryRun?: boolean;
  execContext?: { interactionPolicy?: { canPrompt(tier: PromptTier): boolean } };
  output?: OutputPort;
}

/**
 * Confirm removal operation with user.
 * Uses unified output (clack in interactive mode, plain console otherwise).
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

  const policy = options.execContext?.interactionPolicy;
  if (!policy?.canPrompt(PromptTier.Confirmation)) {
    throw new Error('Removal requires confirmation. Use --force in non-interactive mode.');
  }

  const out = resolveOutput(options);
  const confirmed = await out.confirm('Confirm removal?', { initial: false });
  if (!confirmed) {
    throw new UserCancellationError();
  }
  return true;
}
