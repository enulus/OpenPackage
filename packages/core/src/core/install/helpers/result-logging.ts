/**
 * Result Logging Helpers
 * 
 * Shared utilities for logging installation results, conflicts, and errors.
 * Provides consistent logging behavior across installation modules.
 */

import { logger } from '../../../utils/logger.js';
import { toTildePath } from '../../../utils/path-resolution.js';
import type { FlowInstallResult, FlowConflictReport, FlowInstallError } from '../strategies/types.js';

/**
 * Log conflicts from FlowInstallResult
 * 
 * @param conflicts - Array of conflict reports
 */
export function logConflicts(conflicts: FlowConflictReport[]): void {
  if (conflicts.length === 0) return;
  
  logger.warn(`Detected ${conflicts.length} conflicts during installation`);
  for (const conflict of conflicts) {
    const winner = conflict.packages.find(p => p.chosen);
    const loser = conflict.packages.find(p => !p.chosen);
    logger.warn(
      `  ${toTildePath(conflict.targetPath)}: ${winner?.packageName} (priority ${winner?.priority}) overwrites ${loser?.packageName}`
    );
  }
}

/**
 * Log errors from FlowInstallResult
 * 
 * @param errors - Array of installation errors
 */
export function logErrors(errors: FlowInstallError[]): void {
  if (errors.length === 0) return;
  
  logger.error(`Encountered ${errors.length} errors during installation`);
  for (const error of errors) {
    logger.error(`  ${error.sourcePath}: ${error.message}`);
  }
}

/**
 * Log conflict messages (string array format)
 * 
 * Used by flow-index-installer which aggregates conflicts across platforms.
 * 
 * @param conflicts - Array of conflict message strings
 */
export function logConflictMessages(conflicts: string[]): void {
  if (conflicts.length === 0) return;
  
  logger.warn(`Detected ${conflicts.length} conflicts during installation:`);
  for (const conflict of conflicts) {
    logger.warn(`  ${conflict}`);
  }
}

/**
 * Log error messages (string array format)
 * 
 * Used by flow-index-installer which aggregates errors across platforms.
 * 
 * @param errors - Array of error message strings
 */
export function logErrorMessages(errors: string[]): void {
  if (errors.length === 0) return;
  
  logger.error(`Encountered ${errors.length} errors during installation:`);
  for (const error of errors) {
    logger.error(`  ${error}`);
  }
}

/**
 * Log complete installation result with processing summary
 * 
 * Logs files processed/written and then delegates to conflict/error logging.
 * 
 * @param result - Flow installation result
 * @param packageName - Package being installed
 * @param platform - Target platform
 * @param dryRun - Whether this is a dry run
 */
export function logInstallationResult(
  result: FlowInstallResult,
  packageName: string,
  platform: string,
  dryRun: boolean
): void {
  if (result.filesProcessed > 0) {
    logger.info(
      `Processed ${result.filesProcessed} files for ${packageName} on platform ${platform}` +
      (dryRun ? ' (dry run)' : `, wrote ${result.filesWritten} files`)
    );
  }
  
  logConflicts(result.conflicts);
  logErrors(result.errors);
}
