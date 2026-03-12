/**
 * Resource Provenance
 *
 * Resolves a resource name to the package(s) that installed it,
 * enriched with provenance from the workspace index.
 *
 * Extracted from which-pipeline.ts for reuse by the `ls` command.
 */

import path from 'path';

import { resolveByName, type ResolutionCandidate } from './resource-resolver.js';
import { traverseScopesFlat, type TraverseScopesOptions, type ResourceScope } from './scope-traversal.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { exists } from '../../utils/fs.js';
import { checkContentStatus, type ContentStatus } from '../list/content-status-checker.js';
import { getMarkerFilename, toPluralKey, type ResourceTypeId } from './resource-registry.js';
import type { ResolvedResource } from './resource-builder.js';
import { parseResourceQuery } from './resource-query.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import type { EnhancedFileMapping } from '../list/list-tree-renderer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvenanceResult {
  resourceName: string;
  resourceType: string;
  kind: 'tracked' | 'untracked';
  scope: ResourceScope;
  packageName?: string;
  packageVersion?: string;
  packageSourcePath?: string;
  files: EnhancedFileMapping[];
  /** Aggregate resource-level status derived from file statuses (worst-wins). */
  resourceStatus?: string;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Resolve which package(s) a resource belongs to.
 */
export async function resolveProvenance(
  input: string,
  traverseOpts: TraverseScopesOptions,
  options?: { status?: boolean }
): Promise<ProvenanceResult[]> {
  const query = parseResourceQuery(input);

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
  const results: ProvenanceResult[] = [];

  for (const { candidate, targetDir } of filtered) {
    const resource = candidate.resource!;
    const result: ProvenanceResult = {
      resourceName: resource.resourceName,
      resourceType: resource.resourceType,
      kind: resource.kind,
      scope: resource.scope,
      files: [],
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

          // Build EnhancedFileMapping[] from index file mappings for this resource's source keys
          const filteredFiles: Record<string, (string | typeof pkgEntry.files[string][number])[]> = {};
          for (const key of resource.sourceKeys) {
            if (pkgEntry.files[key]) {
              filteredFiles[key] = pkgEntry.files[key];
            }
          }

          // Build file mappings with existence checks
          const enhancedFiles: EnhancedFileMapping[] = [];
          for (const [sourceKey, mappings] of Object.entries(filteredFiles)) {
            for (const mapping of mappings) {
              const targetPath = getTargetPath(mapping);
              const fileExists = await exists(path.join(targetDir, targetPath));
              enhancedFiles.push({
                source: sourceKey,
                target: targetPath,
                exists: fileExists,
                status: fileExists ? 'tracked' : 'missing',
                scope: resource.scope,
              });
            }
          }

          // Content status enrichment when --status is active
          if (options?.status && Object.keys(filteredFiles).length > 0) {
            const sourceRoot = resolveDeclaredPath(pkgEntry.path, targetDir).absolute;
            if (await exists(sourceRoot)) {
              const { statusMap } = await checkContentStatus(targetDir, sourceRoot, filteredFiles);
              for (const file of enhancedFiles) {
                // Find matching status via "sourceKey::targetPath" composite key
                const compositeKey = `${file.source}::${file.target}`;
                const contentStatus = statusMap.get(compositeKey);
                if (contentStatus) {
                  file.contentStatus = contentStatus;
                  // Derive file-level status from content status (same logic as scope-data-collector)
                  if (!file.exists) {
                    file.status = 'missing';
                  } else if (contentStatus === 'modified') {
                    file.status = 'modified';
                  } else if (contentStatus === 'outdated') {
                    file.status = 'outdated';
                  } else if (contentStatus === 'diverged') {
                    file.status = 'diverged';
                  } else if (contentStatus === 'source-deleted') {
                    file.status = 'outdated';
                  } else if (contentStatus === 'clean') {
                    file.status = 'clean';
                  }
                }
              }
            }
          }

          result.files = enhancedFiles;
          result.resourceStatus = deriveAggregateResourceStatus(enhancedFiles);
        }
      } catch {
        // Provenance enrichment is best-effort — fall back to basic file info
        result.files = resource.targetFiles.map(tp => ({
          source: tp,
          target: tp,
          exists: true,
          status: 'tracked' as const,
          scope: resource.scope,
        }));
      }
    } else if (resource.kind === 'untracked') {
      // Untracked files were found by filesystem scan — they exist
      result.files = resource.targetFiles.map(tp => ({
        source: tp,
        target: tp,
        exists: true,
        status: 'untracked' as const,
        scope: resource.scope,
      }));
      result.resourceStatus = 'untracked';
    }

    results.push(result);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive worst-wins aggregate status from EnhancedFileMapping statuses.
 */
function deriveAggregateResourceStatus(files: EnhancedFileMapping[]): string | undefined {
  if (files.length === 0) return undefined;
  const statuses = files.map(f => f.status);
  if (statuses.includes('diverged')) return 'diverged';
  if (statuses.includes('modified')) return 'modified';
  if (statuses.includes('outdated')) return 'outdated';
  if (statuses.every(s => s === 'missing')) return 'missing';
  if (statuses.every(s => s === 'untracked')) return 'untracked';
  return undefined;
}

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
