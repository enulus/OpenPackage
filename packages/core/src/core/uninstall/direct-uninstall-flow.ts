/**
 * Direct Uninstall Flow
 *
 * Core orchestration for `opkg un <name>` (non-interactive).
 * Resolves candidates across scopes, disambiguates, and executes.
 * No terminal-UI dependencies — uses OutputPort/PromptPort via context.
 */

import type { UninstallOptions } from '../../types/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import type { ResourceScope } from '../resources/scope-traversal.js';
import { resolveResourceSpec } from '../resources/resource-spec.js';
import { getCandidateScope } from '../resources/resource-resolver.js';
import { executeUninstallCandidate } from './uninstall-executor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectUninstallOptions extends UninstallOptions {
  global?: boolean;
}

export interface DirectUninstallResult {
  uninstalledCount: number;
  cancelled: boolean;
  uninstalledItems: Array<{
    name: string;
    kind: 'package' | 'resource';
    resourceType?: string;
    scope: ResourceScope;
  }>;
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

/**
 * Run the direct (non-interactive) uninstall flow:
 * 1. Parse input for optional type qualifier (e.g., `skills/my-skill`)
 * 2. Traverse scopes and resolve candidates by name
 * 3. Filter by type if type-qualified
 * 4. Disambiguate if multiple matches
 * 5. Execute uninstall for each selected candidate
 */
export async function runDirectUninstallFlow(
  name: string,
  options: DirectUninstallOptions,
  traverseOpts: { programOpts?: Record<string, any>; globalOnly?: boolean; projectOnly?: boolean },
  createContext: (opts: { global: boolean; cwd?: string; interactive: boolean }) => Promise<ExecutionContext>
): Promise<DirectUninstallResult> {
  // Create a temporary context for prompt/output port access during disambiguation
  const disambiguationCtx = await createContext({
    global: traverseOpts.globalOnly ?? false,
    cwd: traverseOpts.programOpts?.cwd,
    interactive: true,
  });

  const selected = await resolveResourceSpec(name, traverseOpts, {
    notFoundMessage: `"${name}" not found as a package.\nHint: To target a resource, use its qualified name (e.g., skills/${name}).\nRun \`opkg ls\` to see installed resources.`,
    promptMessage: 'Select which to uninstall:',
  }, disambiguationCtx);

  if (selected.length === 0) {
    return { uninstalledCount: 0, cancelled: true, uninstalledItems: [] };
  }

  const uninstalledItems: DirectUninstallResult['uninstalledItems'] = [];

  for (const { candidate } of selected) {
    const ctx = await createContext({
      global: getCandidateScope(candidate) === 'global',
      cwd: traverseOpts.programOpts?.cwd,
      interactive: false,
    });
    await executeUninstallCandidate(candidate, options, ctx);

    uninstalledItems.push(candidate.kind === 'package'
      ? { name: candidate.package!.packageName, kind: 'package' as const, scope: getCandidateScope(candidate)! }
      : { name: candidate.resource!.resourceName, kind: 'resource' as const, resourceType: candidate.resource!.resourceType, scope: getCandidateScope(candidate)! }
    );
  }

  return { uninstalledCount: selected.length, cancelled: false, uninstalledItems };
}
