import { join } from 'path';
import { convertSourceToWorkspace, ensureComparableHash } from './save-conversion-helper.js';
import { logger } from '../../utils/logger.js';
import { exists, readTextFile } from '../../utils/fs.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { createPlatformSpecificRegistryPath, isPlatformSpecific } from '../platform/platform-specific-paths.js';
import type { PromptPort, PromptChoice } from '../ports/prompt.js';
import { resolvePrompt } from '../ports/resolve.js';
import type { SaveCandidate, SaveCandidateGroup } from './save-types.js';

/**
 * Interactive Conflict Resolver
 *
 * Single-select per conflict group. Parity filtering is silent.
 * No per-conflict headers or summaries.
 *
 * @module save-interactive-resolver
 */

/**
 * Input parameters for interactive resolution
 */
export interface InteractiveResolutionInput {
  /** The registry path being resolved */
  registryPath: string;

  /** Array of workspace candidates (should be unique and sorted by mtime) */
  workspaceCandidates: SaveCandidate[];

  /** Complete candidate group (for parity checking) */
  group: SaveCandidateGroup;

  /** Package source absolute path (for parity checking) */
  packageRoot: string;

  /** Workspace root absolute path (for conversion) */
  workspaceRoot: string;
}

/**
 * Output result from interactive resolution
 */
export interface InteractiveResolutionOutput {
  /** Selected universal candidate (null if skipped or all at parity) */
  selectedCandidate: SaveCandidate | null;

  /** Array of platform-specific candidates (always empty in new flow) */
  platformSpecificCandidates: SaveCandidate[];
}

/**
 * Result of parity checking
 */
interface ParityCheck {
  /** Whether candidate is already at parity with source */
  atParity: boolean;

  /** Human-readable reason (if at parity) */
  reason?: string;
}

/**
 * Run interactive resolution flow with parity checking
 *
 * Algorithm:
 * 1. Sort candidates newest-first
 * 2. Silent parity filtering — no output for filtered candidates
 * 3. If 0 remain → return null (no prompt)
 * 4. If 1 remains → auto-select (no prompt)
 * 5. If 2+ remain → single select prompt with Skip option
 *
 * @param input - Interactive resolution input parameters
 * @returns Resolution output with selected candidate
 */
export async function resolveInteractively(
  input: InteractiveResolutionInput,
  prompt?: PromptPort
): Promise<InteractiveResolutionOutput> {
  const { registryPath, workspaceCandidates, group, packageRoot, workspaceRoot } = input;
  const prm = prompt ?? resolvePrompt();

  // Silent parity filtering (candidates arrive pre-sorted by executor)
  const filtered: SaveCandidate[] = [];
  for (const candidate of workspaceCandidates) {
    const parityCheck = await isAtParity(candidate, group, packageRoot, workspaceRoot);
    if (!parityCheck.atParity) {
      filtered.push(candidate);
    }
  }

  // 0 remain → all at parity
  if (filtered.length === 0) {
    return { selectedCandidate: null, platformSpecificCandidates: [] };
  }

  // 1 remains → auto-select
  if (filtered.length === 1) {
    return { selectedCandidate: filtered[0], platformSpecificCandidates: [] };
  }

  // 2+ remain → single select prompt
  const choices: PromptChoice<SaveCandidate | null>[] = filtered.map(c => ({
    title: `${c.displayPath} ${formatCandidateLabel(c)}`,
    value: c
  }));
  choices.push({ title: 'Skip', value: null });

  const selected = await prm.select<SaveCandidate | null>(
    `${registryPath} — ${filtered.length} versions`,
    choices
  ) ?? null;

  return { selectedCandidate: selected, platformSpecificCandidates: [] };
}

/**
 * Check forward parity by simulating export flow
 *
 * Given a workspace candidate and source candidate, apply the export flow
 * that would transform source → workspace and check if the result matches
 * the actual workspace file.
 *
 * @param workspaceCandidate - Workspace file to check
 * @param localCandidate - Source file
 * @param packageRoot - Package root directory
 * @param workspaceRoot - Workspace root directory
 * @returns Parity check result
 */
async function checkForwardParity(
  workspaceCandidate: SaveCandidate,
  localCandidate: SaveCandidate,
  packageRoot: string,
  workspaceRoot: string
): Promise<ParityCheck> {
  try {
    const result = await convertSourceToWorkspace(
      localCandidate.content,
      workspaceCandidate.platform!,
      localCandidate.registryPath,
      workspaceCandidate.displayPath,
      workspaceRoot
    );

    if (result.success && result.convertedHash) {
      logger.debug(
        `Forward conversion check: converted source hash=${result.convertedHash}, ` +
        `workspace hash=${workspaceCandidate.contentHash}`
      );

      if (result.convertedHash === workspaceCandidate.contentHash) {
        return {
          atParity: true,
          reason: 'Matches source after forward conversion (export flow)'
        };
      }
    }
  } catch (error) {
    logger.debug(`Forward parity check failed: ${error}`);
  }

  return { atParity: false };
}

/**
 * Check if candidate is already at parity with source (conversion-aware and merge-aware)
 *
 * @param candidate - The workspace candidate to check
 * @param group - The complete candidate group
 * @param packageRoot - Package source absolute path
 * @param workspaceRoot - Workspace root for conversion
 * @returns Parity check result with reason if at parity
 */
async function isAtParity(
  candidate: SaveCandidate,
  group: SaveCandidateGroup,
  packageRoot: string,
  workspaceRoot: string
): Promise<ParityCheck> {
  // Check universal parity (conversion-aware and merge-aware)
  if (group.local) {
    const comparisonHash = await ensureComparableHash(candidate, workspaceRoot);

    logger.debug(
      `Parity check for ${candidate.displayPath}: ` +
      `comparisonHash=${comparisonHash}, ` +
      `localHash=${group.local.contentHash}`
    );

    if (comparisonHash === group.local.contentHash) {
      return {
        atParity: true,
        reason: 'Already matches universal (cached comparable hash)'
      };
    }

    if (isPlatformSpecific(candidate.platform) && !(candidate.mergeStrategy && candidate.mergeKeys && candidate.mergeKeys.length > 0)) {
      const forwardCheck = await checkForwardParity(
        candidate,
        group.local,
        packageRoot,
        workspaceRoot
      );

      if (forwardCheck.atParity) {
        return forwardCheck;
      }
    }
  }

  // Check platform-specific parity (if candidate has platform)
  if (isPlatformSpecific(candidate.platform)) {
    const platformPath = createPlatformSpecificRegistryPath(
      group.registryPath,
      candidate.platform!
    );

    if (platformPath) {
      const platformFullPath = join(packageRoot, platformPath);

      if (await exists(platformFullPath)) {
        try {
          const platformContent = await readTextFile(platformFullPath);
          const platformHash = await calculateFileHash(platformContent);

          if (candidate.contentHash === platformHash) {
            return {
              atParity: true,
              reason: 'Already matches platform-specific file'
            };
          }
        } catch (error) {
          logger.debug(`Could not read platform file ${platformFullPath}: ${error}`);
        }
      }
    }
  }

  return { atParity: false };
}

/**
 * Format candidate label for display
 *
 * Compact format: `(claude, 8:47 PM)`
 *
 * @param candidate - The candidate to format
 * @returns Formatted candidate label
 */
function formatCandidateLabel(candidate: SaveCandidate): string {
  const date = new Date(candidate.mtime);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (isPlatformSpecific(candidate.platform)) {
    return `(${candidate.platform}, ${time})`;
  }

  return `(${time})`;
}
