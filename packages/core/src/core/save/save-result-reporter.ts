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
import type { WriteResult, StatusSummary } from './save-types.js';

/**
 * SaveReport contains aggregated save operation results
 * 
 * This structure provides all the data needed to display
 * a comprehensive summary of the save operation to the user.
 */
export interface SaveReport {
  /** Package name that was saved */
  packageName: string;

  /** Whether this was a dry-run (no files written) */
  dryRun?: boolean;

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

  /** Number of conflicts skipped due to --conflicts skip/auto */
  conflictsSkipped: number;

  /** Details of skipped conflicts */
  skippedConflicts: Array<{ registryPath: string; candidateCount: number; reason: string }>;

  /** Write errors that occurred */
  errors: Array<{ path: string; error: Error }>;

  /** All write results (for detailed reporting) */
  writeResults: WriteResult[];

  /** Number of files that were already clean (skipped by pre-filter) */
  filesClean: number;

  /** Number of files that were outdated (source updated, skipped) */
  filesOutdated: number;

  /** Number of files that diverged (both sides changed) */
  filesDiverged: number;

  /** Paths of outdated files (for user guidance) */
  outdatedFilePaths: string[];

  /** Paths of diverged files (for user awareness) */
  divergedFilePaths: string[];
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
  allWriteResults: WriteResult[][],
  dryRun?: boolean,
  statusSummary?: StatusSummary
): SaveReport {
  // Count groups
  const totalGroups = analyses.length;
  const groupsWithAction = analyses.filter(
    a => a.type !== 'no-action-needed' && a.type !== 'no-change-needed'
  ).length;

  // Flatten write results
  const flatResults = allWriteResults.flat();

  // Count successful writes (exclude 'skip' — source already had correct content)
  const successfulWrites = flatResults.filter(r => r.success && r.operation.operation !== 'skip');
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

  // Count skipped conflicts
  const skippedConflicts = analyses
    .filter(a => a.skippedReason)
    .map(a => ({
      registryPath: a.registryPath,
      candidateCount: a.uniqueWorkspaceCandidates.length,
      reason: a.skippedReason!
    }));

  // Extract errors
  const errors = flatResults
    .filter(r => !r.success)
    .map(r => ({
      path: r.operation.registryPath,
      error: r.error || new Error('Unknown write error')
    }));

  // Status summary fields
  const filesClean = statusSummary?.cleanFileCount ?? 0;
  const filesOutdated = statusSummary?.outdatedFiles.length ?? 0;
  const filesDiverged = statusSummary?.divergedFiles.length ?? 0;
  const outdatedFilePaths = statusSummary?.outdatedFiles ?? [];
  const divergedFilePaths = statusSummary?.divergedFiles ?? [];

  return {
    packageName,
    dryRun,
    totalGroups,
    groupsWithAction,
    filesSaved,
    filesCreated,
    filesUpdated,
    platformSpecificFiles,
    interactiveResolutions,
    conflictsSkipped: skippedConflicts.length,
    skippedConflicts,
    errors,
    writeResults: flatResults,
    filesClean,
    filesOutdated,
    filesDiverged,
    outdatedFilePaths,
    divergedFilePaths
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
  const prefix = report.dryRun ? '(dry-run) Would save' : 'Saved';

  if (report.filesSaved === 0 && report.errors.length === 0) {
    const noChangeParts = [`${prefix} ${report.packageName}\n  No changes detected`];
    if (report.filesClean > 0) {
      noChangeParts.push(`  ${report.filesClean} file(s) already clean`);
    }
    if (report.filesOutdated > 0) {
      noChangeParts.push(`  ${report.filesOutdated} file(s) outdated (source updated since install)`);
      noChangeParts.push(`  Run 'opkg install ${report.packageName}' to sync latest source changes`);
    }
    return noChangeParts.join('\n');
  }

  lines.push(`${prefix} ${report.packageName}`);

  if (report.filesCreated > 0) {
    const verb = report.dryRun ? 'would be created' : 'created';
    lines.push(`  ${report.filesCreated} file(s) ${verb}`);
  }

  if (report.filesUpdated > 0) {
    const verb = report.dryRun ? 'would be updated' : 'updated';
    lines.push(`  ${report.filesUpdated} file(s) ${verb}`);
  }

  if (report.filesClean > 0) {
    lines.push(`  ${report.filesClean} file(s) already clean`);
  }

  if (report.filesOutdated > 0) {
    lines.push(`  ${report.filesOutdated} file(s) outdated (source updated since install)`);
  }

  if (report.platformSpecificFiles > 0) {
    lines.push(`  ${report.platformSpecificFiles} platform-specific file(s)`);
  }

  if (report.interactiveResolutions > 0) {
    lines.push(`  ${report.interactiveResolutions} interactive resolution(s)`);
  }

  if (report.conflictsSkipped > 0) {
    lines.push(`  ${report.conflictsSkipped} conflict(s) skipped`);
  }

  if (report.errors.length > 0) {
    lines.push('');
    lines.push(`⚠️  ${report.errors.length} error(s) occurred:`);
    report.errors.forEach(err => {
      lines.push(`  • ${err.path}: ${err.error.message}`);
    });
  }

  const successfulWrites = report.writeResults.filter(r => r.success);
  if (successfulWrites.length > 0) {
    lines.push('');
    const filesLabel = report.dryRun ? 'Files that would be saved:' : 'Files saved:';
    lines.push(`  ${filesLabel}`);

    const sorted = [...successfulWrites].sort((a, b) =>
      a.operation.registryPath.localeCompare(b.operation.registryPath)
    );

    for (const result of sorted) {
      const { registryPath, isPlatformSpecific, platform } = result.operation;
      const label = isPlatformSpecific && platform
        ? `${registryPath} (${platform})`
        : `${registryPath} (universal)`;
      lines.push(`   ├── ${label}`);
    }
  }

  if (report.skippedConflicts.length > 0) {
    lines.push('');
    lines.push('  Skipped conflicts:');
    for (const conflict of report.skippedConflicts) {
      lines.push(`   ├── ${conflict.registryPath} (${conflict.candidateCount} candidates, ${conflict.reason})`);
    }
  }

  if (report.outdatedFilePaths.length > 0) {
    lines.push('');
    lines.push('  Outdated files (source updated since install):');
    for (const filePath of report.outdatedFilePaths) {
      lines.push(`   ├── ${filePath}`);
    }
    lines.push(`  Run 'opkg install ${report.packageName}' to sync latest source changes`);
  }

  if (report.filesSaved > 0 && !report.dryRun) {
    lines.push('');
    lines.push('💡 Changes saved to package source.');
    lines.push('   To sync changes to workspace, run:');
    lines.push(`     opkg install ${report.packageName}`);
  }

  return lines.join('\n');
}

/**
 * Convert SaveReport to a JSON-serializable output object.
 * Used by `opkg save --json`.
 */
export function toSaveJsonOutput(report: SaveReport): Record<string, unknown> {
  return {
    success: true,
    packageName: report.packageName,
    dryRun: report.dryRun ?? false,
    summary: {
      totalGroups: report.totalGroups,
      groupsWithAction: report.groupsWithAction,
      filesSaved: report.filesSaved,
      filesCreated: report.filesCreated,
      filesUpdated: report.filesUpdated,
      platformSpecificFiles: report.platformSpecificFiles,
      conflictsSkipped: report.conflictsSkipped,
      filesClean: report.filesClean,
      filesOutdated: report.filesOutdated,
      filesDiverged: report.filesDiverged,
    },
    status: {
      outdatedFiles: report.outdatedFilePaths,
      divergedFiles: report.divergedFilePaths,
    },
    files: report.writeResults
      .filter(r => r.success)
      .map(r => ({
        registryPath: r.operation.registryPath,
        operation: r.operation.operation,
        success: r.success,
        platform: r.operation.platform ?? null,
        isPlatformSpecific: r.operation.isPlatformSpecific,
      })),
    skippedConflicts: report.skippedConflicts,
    errors: report.errors.map(e => ({
      path: e.path,
      message: e.error.message,
    })),
  };
}
