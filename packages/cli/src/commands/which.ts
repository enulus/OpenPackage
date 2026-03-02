/**
 * Which Command (CLI layer)
 *
 * Thin shell over core/which/ pipeline.
 * Resolves a resource name to the package that installed it.
 */

import type { Command } from 'commander';

import { ValidationError } from '@opkg/core/utils/errors.js';
import { parseWorkspaceScope } from '@opkg/core/core/scope-resolution.js';
import { resolveWhich } from '@opkg/core/core/which/which-pipeline.js';
import { printWhichResults } from '@opkg/core/core/which/which-printers.js';
import type { TraverseScopesOptions } from '@opkg/core/core/resources/scope-traversal.js';

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

async function whichCommand(
  resourceName: string,
  options: { scope?: string; files?: boolean },
  command: Command
): Promise<void> {
  const programOpts = command.parent?.opts() || {};

  const traverseOpts: TraverseScopesOptions = {
    programOpts,
  };

  if (options.scope) {
    try {
      const parsed = parseWorkspaceScope(options.scope);
      if (parsed === 'global') {
        traverseOpts.globalOnly = true;
      } else {
        traverseOpts.projectOnly = true;
      }
    } catch (error) {
      throw error instanceof ValidationError
        ? error
        : new ValidationError(error instanceof Error ? error.message : String(error));
    }
  }

  const results = await resolveWhich(resourceName, traverseOpts);
  printWhichResults(resourceName, results, { files: options.files });
}

// ---------------------------------------------------------------------------
// Command setup
// ---------------------------------------------------------------------------

export async function setupWhichCommand(args: any[]): Promise<void> {
  const [resourceName, options, command] = args as [string | undefined, any, Command];

  if (!resourceName) {
    throw new ValidationError('Resource name is required. Example: opkg which skill-dev');
  }

  await whichCommand(resourceName, options, command);
}
