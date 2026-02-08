import { FILE_PATTERNS } from '../../constants/index.js';
import { calculateConvertedHash, convertSourceToWorkspace, ensureComparableHash } from './save-conversion-helper.js';
import { extractPackageContribution, extractContentByKeys } from './save-merge-extractor.js';
import { logger } from '../../utils/logger.js';
import type { SaveCandidate, SaveCandidateGroup, ResolutionStrategy } from './save-types.js';

/**
 * Conflict analysis and resolution strategy determination
 * 
 * This module classifies candidate groups and determines the appropriate resolution
 * strategy based on the number and similarity of workspace candidates.
 * 
 * @module save-conflict-analyzer
 */

/**
 * ConflictAnalysisType classifies the conflict scenario for a candidate group
 * 
 * - `no-action-needed`: No workspace candidates exist (nothing to save)
 * - `no-change-needed`: Workspace content is identical to source (skip save)
 * - `auto-write`: Single or all-identical workspace candidates (auto-resolve)
 * - `needs-resolution`: Multiple differing workspace candidates (user choice required)
 */
export type ConflictAnalysisType = 
  | 'no-action-needed'      // No workspace candidates
  | 'no-change-needed'      // Workspace matches source exactly
  | 'auto-write'            // Single or identical workspace candidates
  | 'needs-resolution';     // Multiple differing workspace candidates

/**
 * ConflictAnalysis represents the complete analysis of a candidate group
 * 
 * Contains all metadata needed to determine how to handle the group,
 * including conflict type, candidate counts, and recommended strategy.
 */
export interface ConflictAnalysis {
  /** The registry path being analyzed */
  registryPath: string;
  
  /** Classification of conflict scenario */
  type: ConflictAnalysisType;
  
  /** Total number of workspace candidates (before deduplication) */
  workspaceCandidateCount: number;
  
  /** Deduplicated workspace candidates (unique by content hash) */
  uniqueWorkspaceCandidates: SaveCandidate[];
  
  /** Whether a local (source) candidate exists */
  hasLocalCandidate: boolean;
  
  /** Whether source content matches workspace (when single workspace candidate) */
  localMatchesWorkspace: boolean;
  
  /** Whether this is a root package file (AGENTS.md, etc.) */
  isRootFile: boolean;
  
  /** Whether any workspace candidates are platform-specific */
  hasPlatformCandidates: boolean;
  
  /** Recommended resolution strategy based on analysis */
  recommendedStrategy: ResolutionStrategy;
}

/**
 * Analyze a candidate group and determine resolution strategy
 * 
 * This is the primary entry point for conflict analysis. It examines the
 * workspace candidates in a group and determines:
 * 1. What type of conflict (if any) exists
 * 2. Whether the change can be auto-resolved
 * 3. What resolution strategy should be used
 * 
 * **Decision Flow**:
 * ```
 * No workspace candidates → no-action-needed (skip)
 * Single workspace, matches source → no-change-needed (skip)
 * Single workspace, differs from source → auto-write (write-single)
 * Multiple identical workspace → auto-write (write-single after dedup)
 * Multiple differing, force=true → needs-resolution (force-newest)
 * Multiple differing, force=false → needs-resolution (interactive)
 * ```
 * 
 * @param group - The candidate group to analyze
 * @param force - Whether force mode is enabled (auto-select newest)
 * @param workspaceRoot - Workspace root for conversion context
 * @returns Complete conflict analysis with recommended strategy
 */
export async function analyzeGroup(
  group: SaveCandidateGroup,
  force: boolean,
  workspaceRoot: string
): Promise<ConflictAnalysis> {
  const registryPath = group.registryPath;
  const hasLocal = !!group.local;
  const workspaceCandidates = group.workspace;
  const workspaceCandidateCount = workspaceCandidates.length;
  
  // Check if this is a root file (AGENTS.md or similar)
  // Root files may have special handling in some contexts
  const isRootFile = 
    registryPath === FILE_PATTERNS.AGENTS_MD ||
    registryPath === FILE_PATTERNS.CLAUDE_MD ||
    registryPath === FILE_PATTERNS.GEMINI_MD ||
    registryPath === FILE_PATTERNS.QWEN_MD ||
    registryPath === FILE_PATTERNS.WARP_MD ||
    workspaceCandidates.some(c => c.isRootFile);
  
  // Check if any candidates are platform-specific
  // Platform-specific candidates may need separate handling
  const hasPlatformCandidates = workspaceCandidates.some(
    c => c.platform && c.platform !== 'ai'
  );
  
  // Early exit: No workspace candidates means nothing to save
  if (workspaceCandidateCount === 0) {
    return {
      registryPath,
      type: 'no-action-needed',
      workspaceCandidateCount: 0,
      uniqueWorkspaceCandidates: [],
      hasLocalCandidate: hasLocal,
      localMatchesWorkspace: false,
      isRootFile,
      hasPlatformCandidates: false,
      recommendedStrategy: 'skip'
    };
  }
  
  // Deduplicate workspace candidates by converted content hash (merge-aware)
  // Multiple workspace files with identical content (after conversion/extraction) are treated as one
  const uniqueWorkspace = await deduplicateCandidatesWithMerge(workspaceCandidates, workspaceRoot);
  
  // Check if workspace content is identical to source (after conversion)
  // Only applicable when there's exactly one unique workspace candidate
  const localMatchesWorkspace = hasLocal && uniqueWorkspace.length === 1 
    ? await checkConvertedParity(uniqueWorkspace[0], group.local!, workspaceRoot)
    : false;
  
  if (hasLocal && uniqueWorkspace.length > 1) {
    const parityResults = await Promise.all(
      uniqueWorkspace.map(async candidate => ({
        workspacePath: candidate.displayPath,
        platform: candidate.platform || 'none',
        matchesLocal: await checkConvertedParity(candidate, group.local!, workspaceRoot)
      }))
    );
    
    if (parityResults.every(result => result.matchesLocal)) {
      return {
        registryPath,
        type: 'no-change-needed',
        workspaceCandidateCount,
        uniqueWorkspaceCandidates: uniqueWorkspace,
        hasLocalCandidate: hasLocal,
        localMatchesWorkspace: true,
        isRootFile,
        hasPlatformCandidates,
        recommendedStrategy: 'skip'
      };
    }
  }
  
  // No change needed: workspace content is identical to source
  if (localMatchesWorkspace) {
    return {
      registryPath,
      type: 'no-change-needed',
      workspaceCandidateCount,
      uniqueWorkspaceCandidates: uniqueWorkspace,
      hasLocalCandidate: hasLocal,
      localMatchesWorkspace: true,
      isRootFile,
      hasPlatformCandidates,
      recommendedStrategy: 'skip'
    };
  }
  
  // Single unique workspace candidate (or all identical) - can auto-write
  if (uniqueWorkspace.length === 1) {
    return {
      registryPath,
      type: 'auto-write',
      workspaceCandidateCount,
      uniqueWorkspaceCandidates: uniqueWorkspace,
      hasLocalCandidate: hasLocal,
      localMatchesWorkspace: false,
      isRootFile,
      hasPlatformCandidates,
      recommendedStrategy: 'write-single'
    };
  }
  
  // Multiple differing workspace candidates - needs resolution
  // In force mode, auto-select newest; otherwise require user interaction
  const recommendedStrategy: ResolutionStrategy = force ? 'force-newest' : 'interactive';
  
  return {
    registryPath,
    type: 'needs-resolution',
    workspaceCandidateCount,
    uniqueWorkspaceCandidates: uniqueWorkspace,
    hasLocalCandidate: hasLocal,
    localMatchesWorkspace: false,
    isRootFile,
    hasPlatformCandidates,
    recommendedStrategy
  };
}

/**
 * Check if workspace candidate matches local candidate after conversion
 * 
 * Helper function for conversion-aware and merge-aware parity checking.
 * For merged files, extracts package contribution before comparing.
 * For platform-specific files, converts workspace content to universal format before comparing.
 * 
 * @param workspace - Workspace candidate
 * @param local - Local (source) candidate
 * @param workspaceRoot - Workspace root for conversion
 * @returns True if converted hashes match
 */
async function checkConvertedParity(
  workspace: SaveCandidate,
  local: SaveCandidate,
  workspaceRoot: string
): Promise<boolean> {
  const workspaceHash = await ensureComparableHash(workspace, workspaceRoot);

  if (workspace.mergeStrategy && workspace.mergeKeys && workspace.mergeKeys.length > 0) {
    if (workspace.platform && workspace.platform !== 'ai') {
      const forward = await convertSourceToWorkspace(
        local.content,
        workspace.platform as any,
        local.registryPath,
        workspace.displayPath,
        workspaceRoot
      );
      if (forward.success && forward.convertedContent) {
        const localConvertedExtract = await extractContentByKeys(
          forward.convertedContent,
          workspace.mergeKeys
        );
        if (localConvertedExtract.success && localConvertedExtract.extractedHash) {
          return workspaceHash === localConvertedExtract.extractedHash;
        }
      }
    }
    const localExtract = await extractContentByKeys(local.content, workspace.mergeKeys);
    if (localExtract.success && localExtract.extractedHash) {
      return workspaceHash === localExtract.extractedHash;
    }
    return workspaceHash === local.contentHash;
  }

  return workspaceHash === local.contentHash;
}

/**
 * Deduplicate candidates by converted content hash (merge-aware)
 * 
 * Returns only candidates with unique content after conversion to universal format.
 * For merged files, extracts package contribution before deduplication.
 * This enables proper deduplication of platform-specific files that are semantically identical.
 * 
 * **Example**:
 * ```
 * Input: [
 *   { hash: "abc", path: ".cursor/mcp.json", platform: "cursor" },
 *   { hash: "def", path: ".claude/.mcp.json", platform: "claude" },  // different raw hash
 *   { hash: "ghi", path: ".windsurf/mcp.json", platform: "windsurf" }
 * ]
 * After conversion to universal format, cursor and claude both convert to same hash "xyz"
 * Output: [
 *   { hash: "abc", path: ".cursor/mcp.json", platform: "cursor" },  // first occurrence
 *   { hash: "ghi", path: ".windsurf/mcp.json", platform: "windsurf" }
 * ]
 * ```
 * 
 * @param candidates - Array of candidates to deduplicate
 * @param workspaceRoot - Workspace root for conversion context
 * @returns Array of candidates with unique converted content hashes
 */
async function deduplicateCandidatesWithMerge(
  candidates: SaveCandidate[],
  workspaceRoot: string
): Promise<SaveCandidate[]> {
  const seen = new Set<string>();
  const unique: SaveCandidate[] = [];

  for (const candidate of candidates) {
    const hash = await ensureComparableHash(candidate, workspaceRoot);

    logger.debug(
      `Dedup check for ${candidate.displayPath}: hash=${hash}, ` +
      `rawHash=${candidate.contentHash}, seen=${seen.has(hash)}`
    );

    if (seen.has(hash)) {
      logger.debug(`  Skipping duplicate: ${candidate.displayPath}`);
      continue;
    }
    seen.add(hash);
    unique.push(candidate);
  }

  logger.debug(`Deduplication: ${candidates.length} → ${unique.length} unique candidates`);
  return unique;
}

/**
 * Deduplicate candidates by converted content hash (sync version for backward compatibility)
 * 
 * This is a simplified synchronous version that doesn't handle merge extraction.
 * Used by existing tests. For production code, use the merge-aware async version
 * via analyzeGroup.
 * 
 * @deprecated For backward compatibility with tests only.
 * @param candidates - Array of candidates to deduplicate
 * @returns Array of candidates with unique raw content hashes
 */
export function deduplicateCandidates(
  candidates: SaveCandidate[]
): SaveCandidate[] {
  const seen = new Set<string>();
  const unique: SaveCandidate[] = [];
  
  for (const candidate of candidates) {
    const hash = candidate.contentHash;
    
    if (seen.has(hash)) {
      continue;
    }
    seen.add(hash);
    unique.push(candidate);
  }
  
  return unique;
}

/**
 * Check if workspace content differs from local source
 * 
 * Returns true if any workspace candidate has different content than the local source.
 * This is a simple helper for determining if a save operation would change anything.
 * 
 * @param local - The local (source) candidate, or undefined if none exists
 * @param workspace - Array of workspace candidates
 * @returns True if any workspace content differs from local
 */
export function hasContentDifference(
  local: SaveCandidate | undefined,
  workspace: SaveCandidate[]
): boolean {
  if (!local) return true; // No local means creation, which is a difference
  if (workspace.length === 0) return false; // No workspace means no change
  
  // Check if any workspace candidate differs from local
  return workspace.some(w => w.contentHash !== local.contentHash);
}

/**
 * Get the newest candidate by modification time
 * 
 * Returns the candidate with the most recent mtime. Used for auto-selecting
 * in force mode when multiple differing candidates exist.
 * 
 * **Tie-breaking**: If multiple candidates have the same mtime (unlikely but possible),
 * the first one in the array is returned. Consider adding secondary sort by displayPath
 * for deterministic behavior.
 * 
 * @param candidates - Array of candidates to search
 * @returns The candidate with the highest mtime
 * @throws Error if candidates array is empty
 */
export function getNewestCandidate(
  candidates: SaveCandidate[]
): SaveCandidate {
  if (candidates.length === 0) {
    throw new Error('Cannot get newest candidate from empty array');
  }
  
  if (candidates.length === 1) {
    return candidates[0];
  }
  
  // Find candidate with maximum mtime
  let newest = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const current = candidates[i];
    
    // Compare mtime first
    if (current.mtime > newest.mtime) {
      newest = current;
    } else if (current.mtime === newest.mtime) {
      // Tie-breaker: use alphabetical order by displayPath
      if (current.displayPath < newest.displayPath) {
        newest = current;
      }
    }
  }
  
  return newest;
}

/**
 * Sort candidates by modification time (newest first) with tie-breaking
 * 
 * Used to establish a consistent ordering for conflict resolution prompts.
 * Sorts by mtime descending, with displayPath as alphabetical tie-breaker.
 * 
 * **Immutable**: Returns a new sorted array; does not modify the input.
 * 
 * @param candidates - Array of candidates to sort
 * @returns New array sorted by mtime (newest first), then displayPath (A-Z)
 */
export function sortCandidatesByMtime(
  candidates: SaveCandidate[]
): SaveCandidate[] {
  return [...candidates].sort((a, b) => {
    // Primary sort: mtime descending (newest first)
    if (b.mtime !== a.mtime) {
      return b.mtime - a.mtime;
    }
    
    // Tie-breaker: displayPath ascending (alphabetical)
    return a.displayPath.localeCompare(b.displayPath);
  });
}
