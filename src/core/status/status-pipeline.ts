/**
 * Status Pipeline
 * 
 * Core logic for workspace status operations.
 */

import type { CommandResult, ExecutionContext } from '../../types/index.js';
import { ValidationError } from '../../utils/errors.js';
import { exists } from '../../utils/fs.js';
import { getWorkspaceIndexPath } from '../../utils/workspace-index-yml.js';
import { logger } from '../../utils/logger.js';
import { collectTrackedFiles, type TrackedFilesResult } from './tracked-files-collector.js';
import { scanUntrackedFiles, type UntrackedScanResult } from '../list/untracked-files-scanner.js';

/**
 * Options for status command
 */
export interface StatusOptions {
  /** Show tracked files */
  tracked?: boolean;
  /** Show untracked files */
  untracked?: boolean;
  /** Use global scope (home directory) */
  global?: boolean;
  /** Filter by specific platforms */
  platforms?: string[];
}

/**
 * Result of status pipeline
 */
export interface StatusResult {
  /** Tracked files count */
  trackedCount: number;
  /** Untracked files count */
  untrackedCount: number;
  /** Tracked files detail (when --tracked) */
  trackedFiles?: TrackedFilesResult;
  /** Untracked files detail (when --untracked) */
  untrackedFiles?: UntrackedScanResult;
}

/**
 * Run status pipeline
 * 
 * @param execContext - Execution context with target directory
 * @param options - Status options
 * @returns Status result
 */
export async function runStatusPipeline(
  execContext: ExecutionContext,
  options: StatusOptions = {}
): Promise<CommandResult<StatusResult>> {
  const targetDir = execContext.targetDir;
  const indexPath = getWorkspaceIndexPath(targetDir);

  // Validate workspace index exists
  if (!(await exists(indexPath))) {
    throw new ValidationError(
      `No workspace index found at ${indexPath}. ` +
      `Initialize a workspace with 'opkg new' or ensure you're in a valid workspace.`
    );
  }

  // Validate mutual exclusivity
  if (options.tracked && options.untracked) {
    throw new ValidationError(
      'Cannot use --tracked and --untracked together. Choose one.'
    );
  }

  logger.debug('Running status pipeline', { targetDir, options });

  // Handle --tracked flag
  if (options.tracked) {
    logger.info('Collecting tracked files...');
    const trackedFiles = await collectTrackedFiles(targetDir, options.platforms);
    
    return {
      success: true,
      data: {
        trackedCount: trackedFiles.totalFiles,
        untrackedCount: 0,
        trackedFiles
      }
    };
  }

  // Handle --untracked flag
  if (options.untracked) {
    logger.info('Scanning for untracked files...');
    const untrackedFiles = await scanUntrackedFiles(targetDir, options.platforms);
    
    return {
      success: true,
      data: {
        trackedCount: 0,
        untrackedCount: untrackedFiles.totalFiles,
        untrackedFiles
      }
    };
  }

  // Default: Show summary with counts
  logger.info('Generating status summary...');
  
  // Get counts for both tracked and untracked
  const trackedFiles = await collectTrackedFiles(targetDir, options.platforms);
  const untrackedFiles = await scanUntrackedFiles(targetDir, options.platforms);

  return {
    success: true,
    data: {
      trackedCount: trackedFiles.totalFiles,
      untrackedCount: untrackedFiles.totalFiles
    }
  };
}
