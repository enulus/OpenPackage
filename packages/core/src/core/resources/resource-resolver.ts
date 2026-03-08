/**
 * Resource Resolver
 *
 * Resolves a user-provided name (e.g., `custom-rules`) to matching
 * resources and/or packages in the workspace. Used by uninstall, save,
 * and which commands for direct name resolution.
 */

import { buildWorkspaceResources, buildSourceResources, type ResolvedResource, type ResolvedPackage, type WorkspaceResources } from './resource-builder.js';
import type { ResourceScope } from './scope-traversal.js';
import { formatScopeTag } from '../../utils/formatters.js';
import { logger } from '../../utils/logger.js';

export interface ResolutionCandidate {
  kind: 'resource' | 'package';
  resource?: ResolvedResource;
  package?: ResolvedPackage;
}

export interface ResolutionResult {
  candidates: ResolutionCandidate[];
}

// ---------------------------------------------------------------------------
// Candidate accessors
// ---------------------------------------------------------------------------

/** Extract the scope from a resolution candidate. */
export function getCandidateScope(candidate: ResolutionCandidate): ResourceScope | undefined {
  return candidate.kind === 'resource' ? candidate.resource?.scope : candidate.package?.scope;
}

// ---------------------------------------------------------------------------
// Shared candidate formatters (used by uninstall and save disambiguation)
// ---------------------------------------------------------------------------

export function formatCandidateTitle(candidate: ResolutionCandidate): string {
  if (candidate.kind === 'package') {
    const pkg = candidate.package!;
    const version = pkg.version && pkg.version !== '0.0.0' ? ` (v${pkg.version})` : '';
    const scopeTag = formatScopeTag(pkg.scope);
    return `${pkg.packageName}${version} (package, ${pkg.resourceCount} resources)${scopeTag}`;
  }
  const r = candidate.resource!;
  const fromPkg = r.packageName ? `, from ${r.packageName}` : '';
  const scopeTag = formatScopeTag(r.scope);
  return `${r.resourceName} (${r.resourceType}${fromPkg})${scopeTag}`;
}

export function formatCandidateDescription(candidate: ResolutionCandidate): string {
  const files = candidate.kind === 'package'
    ? candidate.package!.targetFiles
    : candidate.resource!.targetFiles;
  if (files.length === 0) return 'no files';
  const displayFiles = files.slice(0, 5);
  const remaining = files.length - displayFiles.length;
  let desc = displayFiles.join('\n');
  if (remaining > 0) {
    desc += `\n+${remaining} more`;
  }
  return desc;
}

// ---------------------------------------------------------------------------
// Shared matching logic
// ---------------------------------------------------------------------------

/**
 * Match a name against resources and packages in a WorkspaceResources structure.
 *
 * Resources are matched case-insensitively by `resourceName`.
 * Packages are matched exactly (case-sensitive) by `packageName`.
 *
 * Pure function — no I/O.
 */
export function matchCandidates(workspace: WorkspaceResources, name: string): ResolutionCandidate[] {
  const candidates: ResolutionCandidate[] = [];
  const nameLower = name.toLowerCase();

  for (const resource of workspace.resources) {
    if (resource.resourceName.toLowerCase() === nameLower) {
      candidates.push({ kind: 'resource', resource });
    }
  }

  for (const pkg of workspace.packages) {
    if (pkg.packageName === name) {
      candidates.push({ kind: 'package', package: pkg });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Workspace-side resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a name to matching resources and packages within a single scope.
 *
 * Resources are matched case-insensitively by `resourceName`.
 * Packages are matched exactly (case-sensitive) by `packageName`.
 *
 * @param name - User-provided name to resolve
 * @param targetDir - Workspace directory to search
 * @param scope - Resource scope ('project' or 'global')
 * @returns Resolution result with matching candidates
 */
export async function resolveByName(
  name: string,
  targetDir: string,
  scope: ResourceScope
): Promise<ResolutionResult> {
  const workspace = await buildWorkspaceResources(targetDir, scope);
  return { candidates: matchCandidates(workspace, name) };
}

// ---------------------------------------------------------------------------
// Source-side resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a name to matching resources in a package source directory.
 *
 * Source-side counterpart to `resolveByName` — scans the package source
 * (e.g., `~/.openpackage/packages/foo/`) instead of the deployed workspace.
 *
 * @param name - User-provided resource name to resolve
 * @param sourceDir - Absolute path to the package source directory
 * @param scope - Resource scope
 * @returns Resolution result with matching candidates
 */
export async function resolveFromSource(
  name: string,
  sourceDir: string,
  scope: ResourceScope
): Promise<ResolutionResult> {
  const workspace = await buildSourceResources(sourceDir, scope);
  return { candidates: matchCandidates(workspace, name) };
}

/**
 * Resolve a name across both project and global scopes.
 * 
 * If the project directory has no .openpackage workspace, only global
 * results are returned (no error is thrown).
 * 
 * @param name - User-provided name to resolve
 * @param projectDir - Project workspace directory
 * @param globalDir - Global workspace directory
 * @returns Combined resolution result from both scopes
 */
export async function resolveAcrossScopes(
  name: string,
  projectDir: string,
  globalDir: string
): Promise<ResolutionResult> {
  let projectCandidates: ResolutionCandidate[] = [];

  try {
    const projectResult = await resolveByName(name, projectDir, 'project');
    projectCandidates = projectResult.candidates;
  } catch (error) {
    logger.debug('Project scope resolution skipped', {
      projectDir,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const globalResult = await resolveByName(name, globalDir, 'global');

  return {
    candidates: [...projectCandidates, ...globalResult.candidates],
  };
}
