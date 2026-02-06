import { logger } from '../../utils/logger.js';
import type { ConflictAnalysis } from './save-conflict-analyzer.js';
import { getNewestCandidate, sortCandidatesByMtime } from './save-conflict-analyzer.js';
import { resolveInteractively } from './save-interactive-resolver.js';
import type { SaveCandidate, SaveCandidateGroup, ResolutionResult } from './save-types.js';

/**
 * Resolution Strategy Executor
 * 
 * This module orchestrates the execution of resolution strategies based on conflict analysis.
 * It delegates to specific resolution functions based on the recommended strategy.
 * 
 * Strategies:
 * - skip: No action needed
 * - write-single: Single workspace candidate (auto-write)
 * - write-newest: Multiple identical candidates (auto-write newest)
 * - force-newest: Multiple differing candidates with force flag (auto-select newest)
 * - interactive: Multiple differing candidates without force flag (prompt user)
 * 
 * @module save-resolution-executor
 */

/**
 * Execute resolution for a candidate group based on conflict analysis
 * 
 * This is the primary entry point for resolution execution. It takes the analysis
 * result and delegates to the appropriate resolution function based on the
 * recommended strategy.
 * 
 * **Flow**:
 * 1. Check if strategy is 'skip' → return null (no action)
 * 2. Sort candidates by mtime (newest first) for consistency
 * 3. Dispatch to strategy-specific function
 * 4. Return ResolutionResult
 * 
 * @param group - The candidate group being resolved
 * @param analysis - Conflict analysis with recommended strategy
 * @param packageRoot - Package source absolute path (for parity checking)
 * @returns ResolutionResult with selection and platform-specific candidates, or null if skip
 */
export async function executeResolution(
  group: SaveCandidateGroup,
  analysis: ConflictAnalysis,
  packageRoot: string
): Promise<ResolutionResult | null> {
  const strategy = analysis.recommendedStrategy;
  
  // Skip if no action needed
  if (strategy === 'skip') {
    return null;
  }
  
  // Sort candidates by mtime (newest first) for consistent ordering
  const sortedCandidates = sortCandidatesByMtime(analysis.uniqueWorkspaceCandidates);
  
  // Dispatch to appropriate resolution function
  switch (strategy) {
    case 'write-single':
      return resolveSingle(sortedCandidates[0]);
    
    case 'write-newest':
      return resolveIdentical(sortedCandidates);
    
    case 'force-newest':
      return resolveForce(sortedCandidates, group.registryPath);
    
    case 'interactive':
      return resolveInteractive(
        group.registryPath,
        sortedCandidates,
        analysis.isRootFile,
        group,
        packageRoot
      );
    
    default:
      logger.warn(`Unknown resolution strategy: ${strategy}`);
      return null;
  }
}

/**
 * Resolve single workspace candidate (auto-write)
 * 
 * This is the simplest case: only one workspace candidate exists,
 * so we use it without prompting the user.
 * 
 * @param candidate - The single workspace candidate
 * @returns ResolutionResult with the candidate as universal selection
 */
function resolveSingle(candidate: SaveCandidate): ResolutionResult {
  return {
    selection: candidate,
    platformSpecific: [],
    strategy: 'write-single',
    wasInteractive: false
  };
}

/**
 * Resolve multiple identical candidates (auto-write newest)
 * 
 * All workspace candidates have identical content (after deduplication).
 * Pick the newest one by mtime and use it as the universal selection.
 * 
 * @param candidates - Array of deduplicated identical candidates
 * @returns ResolutionResult with newest candidate as universal selection
 */
function resolveIdentical(candidates: SaveCandidate[]): ResolutionResult {
  const newest = getNewestCandidate(candidates);
  
  return {
    selection: newest,
    platformSpecific: [],
    strategy: 'write-newest',
    wasInteractive: false
  };
}

/**
 * Force-resolve: Auto-select newest without prompting (force mode)
 * 
 * Multiple differing candidates exist, but --force flag is enabled.
 * Auto-select the newest by mtime without user interaction.
 * 
 * **Tie-breaking**: If multiple candidates have the same mtime (unlikely but possible),
 * the alphabetically first displayPath is selected. This is handled by getNewestCandidate().
 * 
 * **Logging**: Provides detailed logging to show what was selected and what was skipped,
 * with special handling for tie situations.
 * 
 * @param candidates - Array of differing candidates (sorted by mtime)
 * @param registryPath - The registry path being resolved
 * @returns ResolutionResult with newest candidate as universal selection
 */
function resolveForce(
  candidates: SaveCandidate[],
  registryPath: string
): ResolutionResult {
  const newest = getNewestCandidate(candidates);
  
  // Check if there are ties (multiple with same mtime as newest)
  const maxMtime = newest.mtime;
  const tiedCandidates = candidates.filter(c => c.mtime === maxMtime);
  
  if (tiedCandidates.length > 1) {
    // Tie situation - log detailed explanation
    logger.info(
      `Force mode: Multiple files have same modification time (${formatTimestamp(maxMtime)})`
    );
    logger.info(`  Auto-selecting first alphabetically: ${newest.displayPath}`);
    logger.info('  Tied files:');
    tiedCandidates.forEach(c => {
      const marker = c === newest ? '→' : ' ';
      logger.info(`    ${marker} ${c.displayPath}`);
    });
    
    // Log skipped tied files
    const skippedTied = tiedCandidates.filter(c => c !== newest);
    skippedTied.forEach(c => {
      logger.info(`  Skipping: ${c.displayPath} (tied, not alphabetically first)`);
    });
    
    // Log older files
    const olderFiles = candidates.filter(c => c.mtime < maxMtime);
    olderFiles.forEach(c => {
      logger.info(`  Skipping: ${c.displayPath} (older)`);
    });
  } else {
    // Clear winner - simple logging
    logger.info(`Force mode: Auto-selecting newest (${newest.displayPath})`);
    
    // Log what we're skipping
    const skipped = candidates.filter(c => c !== newest);
    if (skipped.length > 0) {
      skipped.forEach(c => {
        logger.info(`  Skipping: ${c.displayPath} (older)`);
      });
    }
  }
  
  return {
    selection: newest,
    platformSpecific: [], // Force mode doesn't auto-create platform-specific variants
    strategy: 'force-newest',
    wasInteractive: false
  };
}

/**
 * Interactive resolve: Prompt user for action (interactive mode)
 * 
 * Multiple differing candidates exist and user interaction is required.
 * Delegates to the interactive resolver module for UI flow and prompts.
 * 
 * @param registryPath - The registry path being resolved
 * @param candidates - Array of differing candidates (sorted by mtime)
 * @param isRootFile - Whether this is a root package file
 * @param group - Complete candidate group (for parity checking)
 * @param packageRoot - Package source absolute path (for parity checking)
 * @returns ResolutionResult with user selections
 */
async function resolveInteractive(
  registryPath: string,
  candidates: SaveCandidate[],
  isRootFile: boolean,
  group: SaveCandidateGroup,
  packageRoot: string
): Promise<ResolutionResult> {
  const result = await resolveInteractively({
    registryPath,
    workspaceCandidates: candidates,
    isRootFile,
    group,
    packageRoot
  });
  
  return {
    selection: result.selectedCandidate,
    platformSpecific: result.platformSpecificCandidates,
    strategy: 'interactive',
    wasInteractive: true
  };
}

/**
 * Format timestamp for human-readable display
 * 
 * Converts millisecond timestamp to locale-specific date/time string.
 * 
 * @param mtime - Modification time in milliseconds
 * @returns Formatted date/time string
 */
function formatTimestamp(mtime: number): string {
  const date = new Date(mtime);
  return date.toLocaleString();
}
