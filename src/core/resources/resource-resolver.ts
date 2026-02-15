/**
 * Resource Resolver
 * 
 * Resolves a user-provided name (e.g., `custom-rules`) to matching
 * resources and/or packages in the workspace. Used by the uninstall
 * command for direct `opkg un <name>` resolution.
 */

import { buildWorkspaceResources, type ResolvedResource, type ResolvedPackage } from './resource-builder.js';
import type { ResourceScope } from './scope-traversal.js';
import { logger } from '../../utils/logger.js';

export interface ResolutionCandidate {
  kind: 'resource' | 'package';
  resource?: ResolvedResource;
  package?: ResolvedPackage;
}

export interface ResolutionResult {
  candidates: ResolutionCandidate[];
}

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
  const candidates: ResolutionCandidate[] = [];
  const nameLower = name.toLowerCase();

  // Match resources by name (case-insensitive)
  for (const resource of workspace.resources) {
    if (resource.resourceName.toLowerCase() === nameLower) {
      candidates.push({ kind: 'resource', resource });
    }
  }

  // Match packages by name (exact, case-sensitive)
  for (const pkg of workspace.packages) {
    if (pkg.packageName === name) {
      candidates.push({ kind: 'package', package: pkg });
    }
  }

  return { candidates };
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
