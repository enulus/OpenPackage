/**
 * Move Validator
 *
 * Validation logic for the move command arguments.
 */

import { validateAsName } from '../add/entry-renamer.js';

/**
 * Validate that at least one of newName, --to, or --from is provided.
 */
export function validateMoveArgs(
  newName: string | undefined,
  to: string | undefined,
  from?: string | undefined,
): void {
  if (!newName && !to && !from) {
    throw new Error(
      'At least one of <new-name>, --to <package>, or --from <package> is required.\n' +
      'Usage:\n' +
      '  opkg move <resource> <new-name>           # rename in place\n' +
      '  opkg move <resource> --to <package>        # relocate to another package\n' +
      '  opkg move <resource> --from <package>      # eject from package\n' +
      '  opkg move <resource> <new-name> --to <pkg> # rename and relocate'
    );
  }

  if (newName) {
    validateAsName(newName);
  }
}

/**
 * Validate that the move operation is not a no-op (same name + same package).
 */
export function validateNotNoop(
  resourceName: string,
  newName: string | undefined,
  sourcePackage: string | undefined,
  to: string | undefined,
): void {
  // Untracked resources with --to are never a noop (they're being adopted)
  if (!sourcePackage) return;

  const effectiveName = newName ?? resourceName;
  const effectivePackage = to ?? sourcePackage;

  if (effectiveName === resourceName && effectivePackage === sourcePackage) {
    throw new Error(
      `Nothing to do: resource "${resourceName}" is already named "${effectiveName}" in package "${effectivePackage}".`
    );
  }
}
