import { createExecutionContext } from '../execution-context.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import { logger } from '../../utils/logger.js';

/**
 * Resource scope for workspace operations
 */
export type ResourceScope = 'project' | 'global';

export interface ScopeEntry {
  scope: ResourceScope;
  context: ExecutionContext;
}

export interface TraverseScopesOptions {
  /** Program-level options (e.g., from command.parent?.opts()) */
  programOpts?: Record<string, any>;
  /** If true, skip project scope entirely */
  globalOnly?: boolean;
  /** If true, skip global scope entirely */
  projectOnly?: boolean;
}

/**
 * Traverse applicable scopes (project and/or global) and run a callback for each.
 * 
 * Project scope failures are silently skipped (common when no .openpackage workspace exists).
 * Global scope failures are also caught and logged.
 * 
 * @param options - Scope traversal options
 * @param callback - Async function to run for each scope
 * @returns Array of results from successful scope callbacks
 */
export async function traverseScopes<T>(
  options: TraverseScopesOptions,
  callback: (entry: ScopeEntry) => Promise<T>
): Promise<Array<{ scope: ResourceScope; result: T }>> {
  const results: Array<{ scope: ResourceScope; result: T }> = [];
  const cwd = options.programOpts?.cwd;

  // Project scope
  if (!options.globalOnly) {
    try {
      const context = await createExecutionContext({ global: false, cwd });
      const result = await callback({ scope: 'project', context });
      results.push({ scope: 'project', result });
    } catch (error) {
      logger.debug('Project scope traversal skipped', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Global scope
  if (!options.projectOnly) {
    try {
      const context = await createExecutionContext({ global: true, cwd });
      const result = await callback({ scope: 'global', context });
      results.push({ scope: 'global', result });
    } catch (error) {
      logger.debug('Global scope traversal skipped', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Traverse scopes and flatten/merge results into a single array.
 * Convenience wrapper when you just need all items across scopes.
 */
export async function traverseScopesFlat<T>(
  options: TraverseScopesOptions,
  callback: (entry: ScopeEntry) => Promise<T[]>
): Promise<T[]> {
  const scopeResults = await traverseScopes(options, callback);
  return scopeResults.flatMap(sr => sr.result);
}
