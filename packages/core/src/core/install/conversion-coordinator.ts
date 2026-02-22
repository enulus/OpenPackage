/**
 * Conversion Coordinator Module
 * 
 * Orchestrates format detection and pre-conversion for packages.
 * Integrates Phase 2 detection and Phase 3 conversion into the installation pipeline.
 * 
 * Phase 4: Integration with Existing Pipeline
 */

import { logger } from '../../utils/logger.js';
import { detectEnhancedPackageFormat } from './format-detector.js';
import { convertFormatGroup } from './import-flow-converter.js';
import { mergeFormatGroups } from './format-group-merger.js';
import { 
  createConversionContext, 
  recordGroupConversion, 
  recordConversionError,
  finalizeConversion,
  type ConversionContext 
} from './conversion-context.js';
import type { 
  PackageFile as DetectionPackageFile,
  EnhancedPackageFormat,
  FormatGroup,
  PlatformId,
  SpecialFormat
} from './detection-types.js';
import type { InstallOptions, PackageFile } from '../../types/index.js';

/**
 * Result of package conversion coordination
 */
export interface PackageConversionResult {
  /**
   * Whether package was converted
   * False if package was already universal or no conversion needed
   */
  wasConverted: boolean;
  
  /**
   * Enhanced format detection result
   */
  formatDetection: EnhancedPackageFormat;
  
  /**
   * Converted files (universal format)
   * If not converted, contains original files
   */
  files: PackageFile[];
  
  /**
   * Conversion context (if conversion occurred)
   */
  conversionContext?: ConversionContext;
  
  /**
   * Conversion errors (if any)
   */
  errors: Error[];
  
  /**
   * Warnings (non-fatal issues)
   */
  warnings: string[];
}

/**
 * Options for conversion coordination
 */
export interface ConversionOptions {
  /**
   * Target directory for platform config loading
   */
  targetDir?: string;
  
  /**
   * Force conversion even if already universal
   */
  forceConversion?: boolean;
  
  /**
   * Skip conversion entirely (passthrough)
   */
  skipConversion?: boolean;
}

/**
 * Coordinate format detection and pre-conversion for a package
 * 
 * This is the main entry point for Phase 4 integration.
 * 
 * Flow:
 * 1. Detect package format (Tier 1: markers, Tier 2: per-file)
 * 2. Determine if conversion is needed
 * 3. If needed, apply per-group conversion
 * 4. Merge converted groups
 * 5. Return unified result
 * 
 * @param files - Package files to process
 * @param contentRoot - Package content root path
 * @param options - Conversion options
 * @returns Conversion result with converted files
 */
export async function coordinateConversion(
  files: DetectionPackageFile[],
  contentRoot: string,
  options: ConversionOptions = {}
): Promise<PackageConversionResult> {
  const errors: Error[] = [];
  const warnings: string[] = [];
  
  try {
    // Skip conversion if requested
    if (options.skipConversion) {
      return {
        wasConverted: false,
        formatDetection: createSkipDetectionResult(files),
        files: convertToMainPackageFiles(files),
        errors: [],
        warnings: []
      };
    }
    
    // Step 1: Enhanced format detection (Phase 2)
    // Cast to main PackageFile type since detection uses its own PackageFile interface
    const formatDetection = await detectEnhancedPackageFormat(files as any);
    
    logger.info('Format detection complete', {
      packageFormat: formatDetection.packageFormat,
      detectionMethod: formatDetection.detectionMethod,
      confidence: formatDetection.confidence,
      totalFiles: formatDetection.analysis.totalFiles
    });
    
    // Step 2: Determine if conversion is needed
    const needsConversion = shouldPreConvert(formatDetection, options);
    
    if (!needsConversion) {
      // Still convert platform-specific groups when package is mostly universal
      // (e.g. agents/foo.opencode.md in otherwise-universal package)
      const hasPlatformSpecificGroups = (formatDetection.formatGroups?.size ?? 0) > 0 &&
        Array.from(formatDetection.formatGroups?.keys() ?? []).some(
          k => k !== 'universal' && k !== 'unknown'
        );
      if (!hasPlatformSpecificGroups) {
        return {
          wasConverted: false,
          formatDetection,
          files: convertToMainPackageFiles(files),
          errors: [],
          warnings: []
        };
      }
    }
    
    // Step 3: Perform pre-conversion (Phase 3)
    logger.info('Pre-converting package to universal format', {
      packageFormat: formatDetection.packageFormat,
      groupCount: formatDetection.formatGroups?.size || 0
    });
    
    const conversionResult = await preConvertPackage(
      files,
      formatDetection,
      options.targetDir
    );
    
    return {
      wasConverted: true,
      formatDetection,
      files: convertToMainPackageFiles(conversionResult.files),
      conversionContext: conversionResult.context,
      errors: conversionResult.errors,
      warnings: conversionResult.warnings
    };
    
  } catch (error) {
    logger.error('Conversion coordination failed', { error });
    errors.push(error instanceof Error ? error : new Error(String(error)));
    
    // Return original files on error (graceful degradation)
    return {
      wasConverted: false,
      formatDetection: createErrorDetectionResult(files, error),
      files: convertToMainPackageFiles(files),
      errors,
      warnings
    };
  }
}



/**
 * Determine if package needs pre-conversion
 * 
 * Conversion needed if:
 * - Package format is platform-specific (not universal)
 * - Package format is mixed (multiple platforms)
 * - Force conversion is enabled
 * 
 * @param format - Enhanced format detection result
 * @param options - Conversion options
 * @returns Whether conversion is needed
 */
export function shouldPreConvert(
  format: EnhancedPackageFormat,
  options: ConversionOptions = {}
): boolean {
  // Force conversion if requested
  if (options.forceConversion) {
    return true;
  }
  
  // Skip if already universal
  if (format.packageFormat === 'universal') {
    return false;
  }
  
  // Convert if platform-specific or mixed
  if (format.packageFormat !== 'unknown') {
    return true;
  }
  
  // Unknown format - don't convert (let existing flow handle it)
  return false;
}

/**
 * Pre-convert package to universal format (Phase 3)
 * 
 * Applies import flows per format group and merges results.
 */
async function preConvertPackage(
  files: DetectionPackageFile[],
  formatDetection: EnhancedPackageFormat,
  targetDir?: string
): Promise<{
  files: DetectionPackageFile[];
  context: ConversionContext;
  errors: Error[];
  warnings: string[];
}> {
  const errors: Error[] = [];
  const warnings: string[] = [];
  
  // Get format groups from detection (paths only)
  const formatGroupPaths = formatDetection.formatGroups;
  
  if (!formatGroupPaths || formatGroupPaths.size === 0) {
    logger.warn('No format groups found for conversion');
    return {
      files,
      context: createConversionContext(new Map()),
      errors: [],
      warnings: ['No format groups found for conversion']
    };
  }
  
  // Create file lookup map for efficient access
  const fileMap = new Map<string, DetectionPackageFile>();
  for (const file of files) {
    fileMap.set(file.path, file);
  }
  
  // Convert path groups to PackageFile groups
  const formatGroups = new Map<PlatformId | SpecialFormat, DetectionPackageFile[]>();
  for (const [platformId, paths] of formatGroupPaths.entries()) {
    const groupFiles: DetectionPackageFile[] = [];
    for (const path of paths) {
      const file = fileMap.get(path);
      if (file) {
        groupFiles.push(file);
      } else {
        logger.warn(`File not found in file map: ${path}`);
      }
    }
    if (groupFiles.length > 0) {
      formatGroups.set(platformId, groupFiles);
    }
  }
  
  // Create conversion context
  const conversionContext = createConversionContext(formatGroups);
  
  // Convert each format group
  const convertedGroups = new Map<PlatformId | SpecialFormat, PackageFile[]>();

  for (const [platformId, groupFiles] of formatGroups.entries()) {
    try {
      // Create format group object
      const formatGroup: FormatGroup = {
        platformId,
        files: groupFiles,
        confidence: 1.0 // Use detection confidence if available
      };
      
      // Convert group using Phase 3 converter
      const groupResult = convertFormatGroup(formatGroup, targetDir);
      
      // Record conversion in context
      // Type cast needed since detection-types and main types are structurally compatible but nominally different
      recordGroupConversion(
        conversionContext,
        platformId,
        groupResult.convertedFiles as any,
        groupResult.filesConverted,
        groupResult.filesProcessed - groupResult.filesConverted
      );
      
      // Collect errors
      for (const fileResult of groupResult.fileResults) {
        if (!fileResult.success && fileResult.error) {
          recordConversionError(
            conversionContext,
            fileResult.original.path,
            fileResult.error
          );
          errors.push(fileResult.error);
        }
      }
      
      // Add to converted groups
      // Type cast needed since detection-types and main types are structurally compatible but nominally different
      convertedGroups.set(platformId, groupResult.convertedFiles as any);
      
    } catch (error) {
      logger.error(`Failed to convert format group: ${platformId}`, { error });
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);
      warnings.push(`Failed to convert ${platformId} format group: ${err.message}`);
      
      // Record error for all files in group
      for (const file of groupFiles) {
        recordConversionError(conversionContext, file.path, err);
      }
    }
  }
  
  // Merge converted groups (Phase 3)
  const mergedFiles = mergeFormatGroups(convertedGroups);
  
  // Finalize conversion context
  finalizeConversion(conversionContext);
  
  logger.info('Pre-conversion complete', {
    totalFiles: mergedFiles.length,
    convertedFiles: conversionContext.metadata.convertedFiles,
    failedFiles: conversionContext.metadata.failedFiles,
    durationMs: conversionContext.metadata.durationMs
  });
  
  // Convert detection PackageFile to main PackageFile (ensure content is present)
  const convertedFiles: PackageFile[] = mergedFiles.map(f => ({
    path: f.path,
    content: f.content || '', // Should always be present, but fallback to empty string
    ...(f.frontmatter && { frontmatter: f.frontmatter })
  })) as PackageFile[];
  
  return {
    files: convertedFiles,
    context: conversionContext,
    errors,
    warnings
  };
}

/**
 * Convert detection PackageFile array to main PackageFile array
 * Ensures all files have content property
 */
function convertToMainPackageFiles(files: DetectionPackageFile[]): PackageFile[] {
  return files.map(f => ({
    path: f.path,
    content: f.content || ''
  }));
}

/**
 * Create a detection result for skipped conversion
 */
function createSkipDetectionResult(files: DetectionPackageFile[]): EnhancedPackageFormat {
  return {
    packageFormat: 'universal',
    detectionMethod: 'package-marker',
    confidence: 1.0,
    analysis: {
      totalFiles: files.length,
      analyzedFiles: 0,
      skippedFiles: files.length,
      formatDistribution: new Map([['universal', files.length]])
    }
  };
}

/**
 * Create a detection result for error case
 */
function createErrorDetectionResult(
  files: DetectionPackageFile[],
  error: unknown
): EnhancedPackageFormat {
  logger.error('Detection failed, returning unknown format', { error });
  
  return {
    packageFormat: 'unknown',
    detectionMethod: 'package-marker',
    confidence: 0,
    analysis: {
      totalFiles: files.length,
      analyzedFiles: 0,
      skippedFiles: files.length,
      formatDistribution: new Map([['unknown', files.length]])
    }
  };
}
