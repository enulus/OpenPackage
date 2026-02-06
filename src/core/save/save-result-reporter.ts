/**
 * Result Reporter
 * 
 * This module formats save operation results for user display.
 * It aggregates write results, conflict analyses, and other pipeline
 * data into a comprehensive report structure.
 * 
 * Key responsibilities:
 * - Build SaveReport from pipeline results
 * - Format user-friendly messages
 * - Create CommandResult objects
 * - Provide helpers for success/error cases
 * 
 * @module save-result-reporter
 */

import type { CommandResult } from '../../types/index.js';
import type { ConflictAnalysis } from './save-conflict-analyzer.js';
import type { WriteResult } from './save-types.js';

/**
 * SaveReport contains aggregated save operation results
 * 
 * This structure provides all the data needed to display
 * a comprehensive summary of the save operation to the user.
 */
export interface SaveReport {
  /** Package name that was saved */
  packageName: string;
  
  /** Total number of candidate groups processed */
  totalGroups: number;
  
  /** Number of groups that required action (not skipped) */
  groupsWithAction: number;
  
  /** Total files written successfully */
  filesSaved: number;
  
  /** Files created (new) */
  filesCreated: number;
  
  /** Files updated (existing) */
  filesUpdated: number;
  
  /** Platform-specific files written */
  platformSpecificFiles: number;
  
  /** Number of interactive resolutions (user prompts) */
  interactiveResolutions: number;
  
  /** Write errors that occurred */
  errors: Array<{ path: string; error: Error }>;
  
  /** All write results (for detailed reporting) */
  writeResults: WriteResult[];
}

/**
 * Build save report from pipeline results
 * 
 * Aggregates data from conflict analyses and write results into
 * a comprehensive SaveReport structure.
 * 
 * @param packageName - Package that was saved
 * @param analyses - Array of conflict analyses (one per group)
 * @param allWriteResults - Array of write result arrays (one array per group)
 * @returns SaveReport with aggregated statistics
 */
export function buildSaveReport(
  packageName: string,
  analyses: ConflictAnalysis[],
  allWriteResults: WriteResult[][]
): SaveReport {
  // Count groups
  const totalGroups = analyses.length;
  const groupsWithAction = analyses.filter(
    a => a.type !== 'no-action-needed' && a.type !== 'no-change-needed'
  ).length;
  
  // Flatten write results
  const flatResults = allWriteResults.flat();
  
  // Count successful writes
  const successfulWrites = flatResults.filter(r => r.success);
  const filesSaved = successfulWrites.length;
  
  // Count created vs updated
  const filesCreated = successfulWrites.filter(
    r => r.operation.operation === 'create'
  ).length;
  const filesUpdated = successfulWrites.filter(
    r => r.operation.operation === 'update'
  ).length;
  
  // Count platform-specific files
  const platformSpecificFiles = successfulWrites.filter(
    r => r.operation.isPlatformSpecific
  ).length;
  
  // Count interactive resolutions
  const interactiveResolutions = analyses.filter(
    a => a.recommendedStrategy === 'interactive' && a.type === 'needs-resolution'
  ).length;
  
  // Extract errors
  const errors = flatResults
    .filter(r => !r.success)
    .map(r => ({
      path: r.operation.registryPath,
      error: r.error || new Error('Unknown write error')
    }));
  
  return {
    packageName,
    totalGroups,
    groupsWithAction,
    filesSaved,
    filesCreated,
    filesUpdated,
    platformSpecificFiles,
    interactiveResolutions,
    errors,
    writeResults: flatResults
  };
}

/**
 * Create CommandResult from SaveReport
 * 
 * Wraps the report in a CommandResult structure with formatted message.
 * 
 * @param report - Save report to wrap
 * @returns CommandResult with success status and formatted message
 */
export function createCommandResult(report: SaveReport): CommandResult {
  return {
    success: true,
    data: {
      message: formatSaveMessage(report),
      report: report
    }
  };
}

/**
 * Create success result for simple cases
 * 
 * Helper for early-exit scenarios like "no changes detected".
 * 
 * @param packageName - Package name
 * @param message - Success message to display
 * @returns CommandResult with success status
 */
export function createSuccessResult(
  packageName: string,
  message: string
): CommandResult {
  return {
    success: true,
    data: {
      message: message,
      packageName: packageName
    }
  };
}

/**
 * Create error result
 * 
 * Helper for error cases throughout the pipeline.
 * 
 * @param error - Error message
 * @returns CommandResult with failure status
 */
export function createErrorResult(error: string): CommandResult {
  return {
    success: false,
    error: error
  };
}

/**
 * Format human-readable save message
 * 
 * Generates a user-friendly message summarizing the save operation.
 * Includes conditional sections based on what occurred.
 * 
 * Template:
 * ```
 * ✓ Saved {packageName}
 *   {filesCreated} file(s) created
 *   {filesUpdated} file(s) updated
 *   {platformSpecificFiles} platform-specific file(s)
 *   {interactiveResolutions} interactive resolution(s)
 * ```
 * 
 * @param report - Save report to format
 * @returns Formatted message string
 */
export function formatSaveMessage(report: SaveReport): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`✓ Saved ${report.packageName}`);
  
  // File counts (conditionally show if non-zero)
  if (report.filesCreated > 0) {
    lines.push(`  ${report.filesCreated} file(s) created`);
  }
  
  if (report.filesUpdated > 0) {
    lines.push(`  ${report.filesUpdated} file(s) updated`);
  }
  
  // Platform-specific files (show if non-zero)
  if (report.platformSpecificFiles > 0) {
    lines.push(`  ${report.platformSpecificFiles} platform-specific file(s)`);
  }
  
  // Interactive resolutions (show if non-zero)
  if (report.interactiveResolutions > 0) {
    lines.push(`  ${report.interactiveResolutions} interactive resolution(s)`);
  }
  
  // Errors (show if any)
  if (report.errors.length > 0) {
    lines.push('');
    lines.push(`⚠️  ${report.errors.length} error(s) occurred:`);
    report.errors.forEach(err => {
      lines.push(`  • ${err.path}: ${err.error.message}`);
    });
  }
  
  // If nothing happened, show zero message
  if (report.filesSaved === 0 && report.errors.length === 0) {
    return `✓ Saved ${report.packageName}\n  No changes detected`;
  }
  
  return lines.join('\n');
}
