/**
 * Conversion Context Module
 * 
 * Tracks conversion state and metadata during per-file/per-group conversion.
 * Provides context for conversion operations and error tracking.
 * 
 * Phase 3: Per-File Import Flow Application
 */

import { logger } from '../../utils/logger.js';
import type { Flow } from '../../types/flows.js';
import type { 
  PackageFile,
  PlatformId,
  SpecialFormat,
  FormatGroup
} from './detection-types.js';

/**
 * Conversion context for tracking state during conversion
 * 
 * Maintains:
 * - Original format groups from detection
 * - Conversion results per group
 * - Errors per file
 * - Cached import flows per platform
 * - Overall statistics
 */
export interface ConversionContext {
  /**
   * Original format groups (keyed by dynamic platform ID)
   * Input to conversion process
   */
  formatGroups: Map<PlatformId | SpecialFormat, PackageFile[]>;
  
  /**
   * Conversion results per group (keyed by dynamic platform ID)
   * Output from conversion process
   */
  convertedGroups: Map<PlatformId | SpecialFormat, PackageFile[]>;
  
  /**
   * Conversion errors per file path
   * Tracks which files failed and why
   */
  errors: Map<string, Error>;
  
  /**
   * Conversion metadata and statistics
   */
  metadata: ConversionMetadata;
  
  /**
   * Platform import flows cache (keyed by dynamic platform ID)
   * Loaded flows cached for reuse across files
   */
  importFlowsCache: Map<PlatformId, Flow[]>;
}

/**
 * Conversion metadata and statistics
 */
export interface ConversionMetadata {
  /** Total files in package */
  totalFiles: number;
  
  /** Files successfully converted */
  convertedFiles: number;
  
  /** Files skipped (already universal or no flows) */
  skippedFiles: number;
  
  /** Files that failed conversion */
  failedFiles: number;
  
  /** Start time of conversion */
  startTime: number;
  
  /** End time of conversion (if complete) */
  endTime?: number;
  
  /** Duration in milliseconds (if complete) */
  durationMs?: number;
}

/**
 * Create a new conversion context from format groups
 * 
 * @param formatGroups - Format groups from detection phase
 * @returns Initialized conversion context
 */
export function createConversionContext(
  formatGroups: Map<PlatformId | SpecialFormat, PackageFile[]>
): ConversionContext {
  // Count total files
  const totalFiles = Array.from(formatGroups.values())
    .reduce((sum, files) => sum + files.length, 0);
  
  return {
    formatGroups,
    convertedGroups: new Map(),
    errors: new Map(),
    metadata: {
      totalFiles,
      convertedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      startTime: Date.now()
    },
    importFlowsCache: new Map()
  };
}

/**
 * Record successful conversion for a group
 * 
 * @param context - Conversion context to update
 * @param platformId - Platform ID of converted group
 * @param convertedFiles - Converted files
 * @param filesConverted - Number of files successfully converted
 * @param filesSkipped - Number of files skipped
 */
export function recordGroupConversion(
  context: ConversionContext,
  platformId: PlatformId | SpecialFormat,
  convertedFiles: PackageFile[],
  filesConverted: number,
  filesSkipped: number
): void {
  context.convertedGroups.set(platformId, convertedFiles);
  context.metadata.convertedFiles += filesConverted;
  context.metadata.skippedFiles += filesSkipped;
}

/**
 * Record conversion error for a file
 * 
 * @param context - Conversion context to update
 * @param filePath - Path of file that failed
 * @param error - Error that occurred
 */
export function recordConversionError(
  context: ConversionContext,
  filePath: string,
  error: Error
): void {
  context.errors.set(filePath, error);
  context.metadata.failedFiles++;
  
  logger.debug(`Recorded conversion error for ${filePath}`, error);
}

/**
 * Mark conversion as complete
 * 
 * Updates metadata with end time and duration.
 * 
 * @param context - Conversion context to finalize
 */
export function finalizeConversion(context: ConversionContext): void {
  context.metadata.endTime = Date.now();
  context.metadata.durationMs = context.metadata.endTime - context.metadata.startTime;
}

/**
 * Get conversion summary
 * 
 * @param context - Conversion context
 * @returns Human-readable summary
 */
export function getConversionSummary(context: ConversionContext): string {
  const { totalFiles, convertedFiles, skippedFiles, failedFiles, durationMs } = context.metadata;
  
  const parts: string[] = [];
  parts.push(`Total: ${totalFiles} files`);
  parts.push(`Converted: ${convertedFiles}`);
  parts.push(`Skipped: ${skippedFiles}`);
  
  if (failedFiles > 0) {
    parts.push(`Failed: ${failedFiles}`);
  }
  
  if (durationMs !== undefined) {
    parts.push(`Duration: ${durationMs}ms`);
  }
  
  return parts.join(', ');
}

/**
 * Check if conversion was successful
 * 
 * @param context - Conversion context
 * @returns Whether all files were converted successfully
 */
export function isConversionSuccessful(context: ConversionContext): boolean {
  return context.metadata.failedFiles === 0;
}

/**
 * Get all conversion errors
 * 
 * @param context - Conversion context
 * @returns Array of [filePath, error] tuples
 */
export function getConversionErrors(
  context: ConversionContext
): Array<[string, Error]> {
  return Array.from(context.errors.entries());
}

/**
 * Cache import flows for a platform
 * 
 * @param context - Conversion context
 * @param platformId - Platform ID
 * @param flows - Import flows to cache
 */
export function cacheImportFlows(
  context: ConversionContext,
  platformId: PlatformId,
  flows: Flow[]
): void {
  context.importFlowsCache.set(platformId, flows);
}

/**
 * Get cached import flows for a platform
 * 
 * @param context - Conversion context
 * @param platformId - Platform ID
 * @returns Cached flows or null if not cached
 */
export function getCachedImportFlows(
  context: ConversionContext,
  platformId: PlatformId
): Flow[] | null {
  return context.importFlowsCache.get(platformId) || null;
}

/**
 * Create format groups from enhanced package format
 * 
 * Helper to convert from detection result to format groups structure.
 * 
 * @param files - All package files
 * @param formatGroups - Map of platform -> file paths from detection
 * @returns Map of platform -> files
 */
export function createFormatGroupsFromPaths(
  files: PackageFile[],
  formatGroups: Map<PlatformId | SpecialFormat, string[]>
): Map<PlatformId | SpecialFormat, PackageFile[]> {
  const result = new Map<PlatformId | SpecialFormat, PackageFile[]>();
  
  // Create file lookup map
  const fileMap = new Map<string, PackageFile>();
  for (const file of files) {
    fileMap.set(file.path, file);
  }
  
  // Build format groups with actual file objects
  for (const [platformId, filePaths] of formatGroups) {
    const groupFiles: PackageFile[] = [];
    
    for (const filePath of filePaths) {
      const file = fileMap.get(filePath);
      if (file) {
        groupFiles.push(file);
      } else {
        logger.warn(`File not found in package: ${filePath}`);
      }
    }
    
    if (groupFiles.length > 0) {
      result.set(platformId, groupFiles);
    }
  }
  
  return result;
}
