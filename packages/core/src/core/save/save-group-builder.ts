/**
 * Save Group Builder Module
 * 
 * Core responsibility: Organize candidates by registry path into groups for analysis
 * 
 * This module takes flat arrays of local and workspace candidates and organizes them
 * into groups where each group represents all versions of a single file (identified by
 * registry path or semantic equivalence after conversion).
 * 
 * Each group contains:
 * - One optional local (source) candidate
 * - Zero or more workspace candidates
 * 
 * Handles matching workspace candidates (e.g., mcp.json) with source candidates (e.g., mcp.jsonc)
 * by finding source files that would produce the workspace file through export flows.
 */

import { getPlatformDefinition, getGlobalExportFlows } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import { minimatch } from 'minimatch';
import type { SaveCandidate, SaveCandidateGroup, LocalSourceRef } from './save-types.js';
import type { Platform } from '../platforms.js';

/**
 * Build candidate groups from local source refs and workspace candidates
 * 
 * Groups candidates intelligently by matching workspace candidates with their
 * corresponding source refs. For platform-specific workspace files,
 * finds the universal source file that would export to that workspace file.
 * 
 * Algorithm:
 * 1. Build initial groups by exact registry path match
 * 2. For workspace candidates without local match, find corresponding source file
 * 3. Match based on export flow patterns (source → workspace)
 * 4. Filter out local-only groups (no workspace candidates)
 * 
 * @param localRefs - Lightweight refs from package source
 * @param workspaceCandidates - Candidates from workspace
 * @param workspaceRoot - Workspace root for flow lookup
 * @returns Array of candidate groups organized by registry path
 */
export function buildCandidateGroups(
  localRefs: LocalSourceRef[],
  workspaceCandidates: SaveCandidate[],
  workspaceRoot: string = process.cwd()
): SaveCandidateGroup[] {
  const map = new Map<string, SaveCandidateGroup>();
  
  logger.debug(`Building groups from ${localRefs.length} local refs and ${workspaceCandidates.length} workspace candidates`);
  
  // Add local refs to groups (using their actual registry paths)
  for (const ref of localRefs) {
    const group = ensureGroup(map, ref.registryPath);
    group.localRef = ref;
    logger.debug(`Added local ref: ${ref.registryPath}`);
  }
  
  // Add workspace candidates to groups
  // Try to match with corresponding source file
  for (const candidate of workspaceCandidates) {
    logger.debug(
      `Processing workspace candidate: ${candidate.displayPath} ` +
      `(registryPath: ${candidate.registryPath}, platform: ${candidate.platform || 'none'})`
    );
    
    // First try exact match by registry path
    let group = map.get(candidate.registryPath);
    
    if (group) {
      logger.debug(`  Found exact match by registryPath: ${candidate.registryPath}`);
    }
    
    // If no exact match, try to find source file via export flows or fallback matching
    // This handles cases where:
    // 1. Platform-specific workspace files need to match universal source
    // 2. Source filename differs from workspace registry path (e.g., mcp.jsonc vs mcp.json)
    if (!group) {
      let sourceRegistryPath = findSourceFileForWorkspace(
        candidate,
        localRefs,
        workspaceRoot
      );
      
      // If export flow matching failed (e.g., platform detection failed),
      // try fallback matching based on filename similarity
      if (!sourceRegistryPath) {
        sourceRegistryPath = findSourceFileByFallback(
          candidate.registryPath,
          localRefs
        );
      }
      
      if (sourceRegistryPath) {
        logger.debug(
          `  Matched to source: workspace ${candidate.displayPath} → source ${sourceRegistryPath}`
        );
        group = ensureGroup(map, sourceRegistryPath);
      } else {
        logger.debug(`  No source match found`);
      }
    }
    
    // If still no match, create group with workspace registry path
    if (!group) {
      logger.debug(`  Creating new group with workspace registryPath: ${candidate.registryPath}`);
      group = ensureGroup(map, candidate.registryPath);
    }
    
    group.workspace.push(candidate);
  }
  
  // Filter out local-only groups (no workspace candidates) during grouping
  const allGroups = Array.from(map.values());
  const activeCount = allGroups.filter(g => g.workspace.length > 0).length;
  logger.debug(`Built ${map.size} candidate groups (${activeCount} with workspace candidates)`);
  
  return allGroups;
}

/**
 * Find source file by fallback filename matching
 * 
 * When export flow matching fails (e.g., due to platform detection failure),
 * try to match workspace registry path to source files by filename similarity.
 * 
 * Tries these strategies in order:
 * 1. Exact match (already tried before calling this)
 * 2. Match with different extension (e.g., mcp.json → mcp.jsonc)
 * 3. Match basename without extension (e.g., opencode.json → mcp.json)
 * 
 * @param registryPath - Workspace registry path to match
 * @param localRefs - All source refs
 * @returns Registry path of matching source file, or null
 */
function findSourceFileByFallback(
  registryPath: string,
  localRefs: LocalSourceRef[]
): string | null {
  const baseName = registryPath.replace(/\.[^.]+$/, '');
  const candidates = localRefs.filter(c => {
    const sourceBaseName = c.registryPath.replace(/\.[^.]+$/, '');
    return sourceBaseName === baseName;
  });
  
  if (candidates.length === 1) {
    logger.debug(`  Fallback match: ${registryPath} → ${candidates[0].registryPath} (same basename)`);
    return candidates[0].registryPath;
  }
  
  const fileName = registryPath.split('/').pop() || '';
  const fileNameBase = fileName.replace(/\.[^.]+$/, '');
  
  if (fileNameBase) {
    const fileNameCandidates = localRefs.filter(c => {
      const sourceFileName = c.registryPath.split('/').pop() || '';
      const sourceFileNameBase = sourceFileName.replace(/\.[^.]+$/, '');
      return sourceFileNameBase === fileNameBase;
    });
    
    if (fileNameCandidates.length === 1) {
      logger.debug(
        `  Fallback match: ${registryPath} → ${fileNameCandidates[0].registryPath} (same filename)`
      );
      return fileNameCandidates[0].registryPath;
    }
  }
  
  return null;
}

/**
 * Find source file that would export to a workspace file
 * 
 * Given a workspace candidate (e.g., .cursor/mcp.json), find the source file
 * (e.g., mcp.jsonc) that would produce it through export flows.
 * 
 * @param workspaceCandidate - Workspace candidate to match
 * @param localRefs - All source refs
 * @param workspaceRoot - Workspace root for flow lookup
 * @returns Registry path of matching source file, or null
 */
function findSourceFileForWorkspace(
  workspaceCandidate: SaveCandidate,
  localRefs: LocalSourceRef[],
  workspaceRoot: string
): string | null {
  const platform = workspaceCandidate.platform as Platform;
  if (!platform || platform === 'ai') {
    return null;
  }
  
  try {
    // Get platform export flows
    const platformDef = getPlatformDefinition(platform, workspaceRoot);
    const platformExportFlows = platformDef.export || [];
    const globalExportFlows = getGlobalExportFlows(workspaceRoot) || [];
    const allExportFlows = [...globalExportFlows, ...platformExportFlows];
    
    logger.debug(`  Checking ${allExportFlows.length} export flows for platform ${platform}`);
    
    // Get workspace path from candidate (relative to workspace root)
    const workspacePath = workspaceCandidate.displayPath;
    
    // Find export flow that would produce this workspace file
    for (const flow of allExportFlows) {
      const toPattern = Array.isArray(flow.to) ? flow.to[0] : flow.to;
      
      // Handle switch expressions
      if (typeof toPattern === 'object' && '$switch' in toPattern) {
        continue; // Skip for now
      }
      
      if (typeof toPattern !== 'string') {
        continue;
      }
      
      // Check if workspace path matches the 'to' pattern
      const toMatches = minimatch(workspacePath, toPattern, { dot: true });
      
      if (!toMatches) {
        continue;
      }
      
      logger.debug(`  Workspace path ${workspacePath} matches 'to' pattern: ${toPattern}`);
      
      // Found matching flow - now find source file that matches 'from' pattern(s)
      const fromPatterns = Array.isArray(flow.from) ? flow.from : [flow.from];
      
      for (const fromPattern of fromPatterns) {
        // Handle switch expressions
        if (typeof fromPattern === 'object' && '$switch' in fromPattern) {
          continue; // Skip for now
        }
        
        if (typeof fromPattern !== 'string') {
          continue;
        }
        
        logger.debug(`  Checking 'from' pattern: ${fromPattern}`);
        
        // Find local ref that matches the 'from' pattern
        for (const ref of localRefs) {
          const fromMatches = minimatch(ref.registryPath, fromPattern, { dot: true });
          
          if (fromMatches) {
            logger.debug(`  Found matching source: ${ref.registryPath}`);
            return ref.registryPath;
          }
        }
      }
    }
    
    logger.debug(`  No matching source file found`);
  } catch (error) {
    logger.warn(`Failed to find source file for workspace candidate: ${error}`);
  }
  
  return null;
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
