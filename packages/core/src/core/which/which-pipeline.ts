/**
 * Which Pipeline
 *
 * Core logic for `opkg which <resource-name>`.
 * Resolves a resource name to the package(s) that installed it,
 * enriched with provenance from the workspace index.
 */

import { resolveByName, type ResolutionCandidate } from '../resources/resource-resolver.js';
import { traverseScopesFlat, type TraverseScopesOptions, type ResourceScope } from '../resources/scope-traversal.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { normalizeType, getMarkerFilename, toPluralKey, type ResourceTypeId } from '../resources/resource-registry.js';
import type { ResolvedResource } from '../resources/resource-builder.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhichResult {
  resourceName: string;
  resourceType: string;
  kind: 'tracked' | 'untracked';
  scope: ResourceScope;
  packageName?: string;
  packageVersion?: string;
  packageSourcePath?: string;
  targetFiles: string[];
}

export interface WhichQuery {
  /** Raw input from user */
  raw: string;
  /** Extracted resource name */
  name: string;
  /** Optional type filter from qualified input (e.g. "skills/skill-dev" → "skill") */
  typeFilter?: string;
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

/**
 * Parse a user query into name + optional type filter.
 *
 * - Bare name: `skill-dev` → { name: "skill-dev" }
 * - Qualified:  `skills/skill-dev` → { name: "skill-dev", typeFilter: "skill" }
 */
export function parseWhichQuery(input: string): WhichQuery {
  const slashIndex = input.indexOf('/');
  if (slashIndex === -1) {
    return { raw: input, name: input };
  }

  const prefix = input.slice(0, slashIndex);
  const name = input.slice(slashIndex + 1);

  if (!name) {
    return { raw: input, name: input };
  }

  const typeFilter = normalizeType(prefix);
  // If normalizeType falls back to 'other', the prefix wasn't a known type
  if (typeFilter === 'other') {
    return { raw: input, name: input };
  }

  return { raw: input, name, typeFilter };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Resolve which package(s) a resource belongs to.
 */
export async function resolveWhich(
  input: string,
  traverseOpts: TraverseScopesOptions
): Promise<WhichResult[]> {
  const query = parseWhichQuery(input);

  // Collect candidates paired with their targetDir for provenance lookup
  const paired: Array<{ candidate: ResolutionCandidate; targetDir: string }> = [];

  await traverseScopesFlat<null>(
    traverseOpts,
    async ({ scope, context }) => {
      const result = await resolveByName(query.name, context.targetDir, scope);
      for (const c of result.candidates) {
        paired.push({ candidate: c, targetDir: context.targetDir });
      }
      return [null];
    }
  );

  // Keep only resource-kind candidates
  let filtered = paired.filter(p => p.candidate.kind === 'resource' && p.candidate.resource);

  // If type-qualified, further filter by type
  if (query.typeFilter) {
    filtered = filtered.filter(
      p => p.candidate.resource!.resourceType === query.typeFilter
    );
  }

  // Enrich with provenance — cache workspace index reads per targetDir
  const indexCache = new Map<string, Awaited<ReturnType<typeof readWorkspaceIndex>>>();
  const results: WhichResult[] = [];

  for (const { candidate, targetDir } of filtered) {
    const resource = candidate.resource!;
    const result: WhichResult = {
      resourceName: resource.resourceName,
      resourceType: resource.resourceType,
      kind: resource.kind,
      scope: resource.scope,
      targetFiles: resource.targetFiles,
    };

    if (resource.kind === 'tracked' && resource.packageName) {
      result.packageName = resource.packageName;

      try {
        let indexRecord = indexCache.get(targetDir);
        if (!indexRecord) {
          indexRecord = await readWorkspaceIndex(targetDir);
          indexCache.set(targetDir, indexRecord);
        }
        const pkgEntry = indexRecord.index.packages[resource.packageName];
        if (pkgEntry) {
          result.packageVersion = pkgEntry.version;
          const relativePath = computeResourceRelativePath(resource);
          if (relativePath) {
            const basePath = pkgEntry.path.replace(/\/+$/, '');
            result.packageSourcePath = `${basePath}/${relativePath}`;
          } else {
            result.packageSourcePath = pkgEntry.path;
          }
        }
      } catch {
        // Provenance enrichment is best-effort
      }
    }

    results.push(result);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the resource's relative path within its package.
 *
 * - Marker-based types (skills): directory path via pluralKey/resourceName
 * - File-based types (agents, rules, etc.): first sourceKey (preserves extension)
 * - MCP: first sourceKey (e.g. "mcp.json")
 */
function computeResourceRelativePath(resource: ResolvedResource): string | undefined {
  const resourceType = resource.resourceType as ResourceTypeId;

  // Marker-based types → directory path (e.g. "skills/skill-dev")
  if (getMarkerFilename(resourceType)) {
    return `${toPluralKey(resourceType)}/${resource.resourceName}`;
  }

  // File-based types → use first source key (preserves extension)
  if (resource.sourceKeys.size > 0) {
    return resource.sourceKeys.values().next().value;
  }

  // Fallback → reconstruct from type/name
  const pluralKey = toPluralKey(resourceType);
  if (pluralKey === 'other') return undefined;
  return `${pluralKey}/${resource.resourceName}`;
}
