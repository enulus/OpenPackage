/**
 * Resource Spec Classification & Resolution
 *
 * Centralized module for classifying and resolving user-provided resource specs
 * (e.g., `agents/ui-designer`, `./file.txt`, `essentials`).
 *
 * Used by add, remove, save, sync, and uninstall commands.
 */

import type { ExecutionContext } from '../../types/execution-context.js';
import type { OutputPort } from '../ports/output.js';
import type { PromptPort } from '../ports/prompt.js';
import { parseResourceQuery, type ResourceQuery } from './resource-query.js';
import { resolveByName, formatCandidateTitle, formatCandidateDescription, getCandidateScope, type ResolutionCandidate } from './resource-resolver.js';
import { traverseScopesFlat, type TraverseScopesOptions } from './scope-traversal.js';
import { disambiguate, type DisambiguationOptions } from './disambiguation-prompt.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type ResourceSpecClassification =
  | { kind: 'explicit-path' }
  | { kind: 'resource-ref'; query: ResourceQuery }
  | { kind: 'other' };

/**
 * Classify a user-provided resource spec string.
 *
 * Synchronous, deterministic, no I/O.
 *
 * Rules (in priority order):
 * 1. `./`, `../`, `/`, `~/` prefix (or `.` / `~` alone) → explicit-path
 * 2. Trailing `/` → other (directory intent)
 * 3. Known type prefix via `parseResourceQuery()` with non-empty name → resource-ref
 * 4. Everything else → other
 */
export function classifyResourceSpec(input: string): ResourceSpecClassification {
  // Rule 1: explicit path prefixes
  if (
    input === '.' ||
    input === '~' ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('/') ||
    input.startsWith('~/')
  ) {
    return { kind: 'explicit-path' };
  }

  // Rule 2: trailing slash → directory intent
  if (input.endsWith('/')) {
    return { kind: 'other' };
  }

  // Rule 3: known type prefix
  const query = parseResourceQuery(input);
  if (query.typeFilter && query.name) {
    return { kind: 'resource-ref', query };
  }

  // Rule 4: everything else
  return { kind: 'other' };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedTarget {
  candidate: ResolutionCandidate;
  targetDir: string;
  /** Absolute path to the package source directory (tilde-expanded from workspace index). */
  packageSourcePath?: string;
}

export interface ResolveResourceSpecOptions extends DisambiguationOptions {
  /** Optional type filter to apply (usually from classifyResourceSpec). Overrides query.typeFilter if provided. */
  typeFilter?: string;
  /** If set, prefer candidates from this scope. When preferred-scope candidates exist, others are dropped before disambiguation. */
  scopePreference?: 'project' | 'global';
}

/**
 * Resolve a user-provided resource spec to concrete candidates.
 *
 * Composes: parseResourceQuery → traverseScopesFlat(resolveByName) → filter → disambiguate.
 *
 * @param input - User-provided resource spec (e.g., `agents/foo`, `foo`)
 * @param traverseOpts - Scope traversal options
 * @param options - Disambiguation options + optional type filter
 * @param ctx - Optional execution context for output/prompt ports
 * @returns Selected resolved targets
 */
export async function resolveResourceSpec(
  input: string,
  traverseOpts: TraverseScopesOptions,
  options?: ResolveResourceSpecOptions,
  ctx?: ExecutionContext,
): Promise<ResolvedTarget[]> {
  const query = parseResourceQuery(input);

  // Resolve candidates across scopes
  const paired: ResolvedTarget[] = [];

  await traverseScopesFlat<null>(
    traverseOpts,
    async ({ scope, context }) => {
      const result = await resolveByName(query.name, context.targetDir, scope);
      if (result.candidates.length > 0) {
        // Read workspace index once per scope to enrich with package source paths
        const { index } = await readWorkspaceIndex(context.targetDir);
        for (const c of result.candidates) {
          let packageSourcePath: string | undefined;
          const pkgName = c.kind === 'resource' ? c.resource?.packageName : c.package?.packageName;
          if (pkgName) {
            const pkgEntry = index.packages[pkgName];
            if (pkgEntry?.path) {
              packageSourcePath = resolveDeclaredPath(pkgEntry.path, context.targetDir).absolute;
            }
          }
          paired.push({ candidate: c, targetDir: context.targetDir, packageSourcePath });
        }
      }
      return [null];
    },
  );

  // If type-qualified, filter by resource type
  const typeFilter = options?.typeFilter ?? query.typeFilter;
  let filtered = paired;
  if (typeFilter) {
    filtered = filtered.filter(
      p => p.candidate.kind === 'resource' && p.candidate.resource?.resourceType === typeFilter,
    );
  }

  // Scope preference: if preferred scope has candidates, drop others
  if (options?.scopePreference && filtered.length > 1) {
    const preferred = filtered.filter(p => getCandidateScope(p.candidate) === options.scopePreference);
    if (preferred.length > 0) {
      filtered = preferred;
    }
  }

  // Disambiguate
  const out = resolveOutput(ctx);
  const prm = resolvePrompt(ctx);

  const selected = await disambiguate(
    input,
    filtered,
    (p) => ({
      title: formatCandidateTitle(p.candidate),
      description: formatCandidateDescription(p.candidate),
      value: p,
    }),
    {
      notFoundMessage: options?.notFoundMessage ?? `"${input}" not found as a resource or package.\nRun \`opkg ls\` to see installed resources.`,
      ambiguousHeader: options?.ambiguousHeader,
      promptMessage: options?.promptMessage ?? 'Select which to act on:',
      multi: options?.multi,
    },
    out,
    prm,
  );

  return selected;
}
