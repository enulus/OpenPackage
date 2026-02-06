/**
 * Save Group Builder Module
 * 
 * Core responsibility: Organize candidates by registry path into groups for analysis
 * 
 * This module takes flat arrays of local and workspace candidates and organizes them
 * into groups where each group represents all versions of a single file (identified by
 * registry path).
 * 
 * Each group contains:
 * - One optional local (source) candidate
 * - Zero or more workspace candidates
 */

import type { SaveCandidate, SaveCandidateGroup } from './save-types.js';

/**
 * Build candidate groups from local and workspace candidates
 * 
 * Groups candidates by registry path, associating:
 * - One optional local (source) candidate per registry path
 * - Zero or more workspace candidates per registry path
 * 
 * Algorithm:
 * 1. Collect all unique registry paths from both local and workspace
 * 2. For each registry path, find corresponding candidates
 * 3. Create SaveCandidateGroup with local + workspace candidates
 * 
 * @param localCandidates - Candidates from package source
 * @param workspaceCandidates - Candidates from workspace
 * @returns Array of candidate groups organized by registry path
 */
export function buildCandidateGroups(
  localCandidates: SaveCandidate[],
  workspaceCandidates: SaveCandidate[]
): SaveCandidateGroup[] {
  const map = new Map<string, SaveCandidateGroup>();
  
  // Add local candidates to groups
  for (const candidate of localCandidates) {
    const group = ensureGroup(map, candidate.registryPath);
    group.local = candidate;
  }
  
  // Add workspace candidates to groups
  for (const candidate of workspaceCandidates) {
    const group = ensureGroup(map, candidate.registryPath);
    group.workspace.push(candidate);
  }
  
  // Convert map to array
  return Array.from(map.values());
}

/**
 * Filter groups to only those with workspace candidates
 * 
 * Since save is workspace → source, we only care about groups
 * that have workspace candidates to save. Groups with no workspace
 * candidates represent files that exist in source but not in workspace
 * (no changes to save).
 * 
 * @param groups - All candidate groups
 * @returns Groups with at least one workspace candidate
 */
export function filterGroupsWithWorkspace(
  groups: SaveCandidateGroup[]
): SaveCandidateGroup[] {
  return groups.filter(group => group.workspace.length > 0);
}

/**
 * Ensure a group exists for the given registry path
 * 
 * Helper function to get or create a group in the map.
 * Creates a new group if one doesn't exist yet.
 * 
 * @param map - Map of registry path to group
 * @param registryPath - Registry path to look up/create
 * @returns The group for this registry path
 */
function ensureGroup(
  map: Map<string, SaveCandidateGroup>,
  registryPath: string
): SaveCandidateGroup {
  let group = map.get(registryPath);
  if (!group) {
    group = {
      registryPath,
      workspace: []
    };
    map.set(registryPath, group);
  }
  return group;
}
