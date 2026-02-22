/**
 * Format Group Merger Module
 * 
 * Merges converted format groups into a unified package structure.
 * Handles path conflicts and deduplication.
 * 
 * Phase 3: Per-File Import Flow Application
 */

import { logger } from '../../utils/logger.js';
import type { PackageFile, PlatformId, SpecialFormat } from './detection-types.js';

/**
 * Validation result for merged package
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  
  /** Validation errors (if any) */
  errors: string[];
  
  /** Validation warnings (if any) */
  warnings: string[];
}

/**
 * Merge format groups into unified package
 * 
 * Combines all converted format groups into a single array of files in universal format.
 * Handles path conflicts using priority-based deduplication.
 * 
 * @param groups - Map of platform ID -> converted files
 * @returns Unified array of files in universal format
 */
export function mergeFormatGroups(
  groups: Map<PlatformId | SpecialFormat, PackageFile[]>
): PackageFile[] {
  // Collect all files from all groups
  const allFiles: PackageFile[] = [];
  
  for (const [platformId, files] of groups) {
    allFiles.push(...files);
  }
  
  // Deduplicate paths with priority-based resolution
  const deduplicated = deduplicatePaths(allFiles);
  
  return deduplicated;
}

/**
 * Deduplicate files by path using priority ordering
 * 
 * Priority (highest to lowest):
 * 1. Universal format (most canonical)
 * 2. Non-universal formats (first occurrence wins)
 * 
 * @param files - Array of files (potentially with duplicate paths)
 * @returns Deduplicated array
 */
export function deduplicatePaths(files: PackageFile[]): PackageFile[] {
  const pathMap = new Map<string, PackageFile>();
  
  for (const file of files) {
    const existing = pathMap.get(file.path);
    
    if (!existing) {
      // First occurrence - add to map
      pathMap.set(file.path, file);
      continue;
    }
    
    // Duplicate path - apply priority rules
    const priority = determinePriority(file, existing);
    
    if (priority === 'new') {
      pathMap.set(file.path, file);
    }
  }
  
  return Array.from(pathMap.values());
}

/**
 * Determine which file has priority for the same path
 * 
 * @param newFile - New file being considered
 * @param existingFile - Existing file in the map
 * @returns Which file to keep ('new' or 'existing')
 */
function determinePriority(
  newFile: PackageFile,
  existingFile: PackageFile
): 'new' | 'existing' {
  // Priority 1: Universal format content
  // Check if files have universal format indicators
  
  const newIsUniversal = isLikelyUniversalFormat(newFile);
  const existingIsUniversal = isLikelyUniversalFormat(existingFile);
  
  if (newIsUniversal && !existingIsUniversal) {
    return 'new';
  }
  
  if (existingIsUniversal && !newIsUniversal) {
    return 'existing';
  }
  
  // Priority 2: First occurrence wins (existing)
  return 'existing';
}

/**
 * Check if file is likely in universal format
 * 
 * Heuristic check based on frontmatter structure.
 * Universal format uses:
 * - tools: array
 * - permissions: object
 * - model: prefixed (anthropic/...)
 * 
 * @param file - File to check
 * @returns Whether file is likely universal format
 */
function isLikelyUniversalFormat(file: PackageFile): boolean {
  if (!file.frontmatter) {
    // No frontmatter - could be universal (e.g., skills)
    return true;
  }
  
  const fm = file.frontmatter;
  
  // Check tools field
  if ('tools' in fm) {
    // Universal uses array
    if (Array.isArray(fm.tools)) {
      return true;
    }
    // Platform-specific uses string or object
    return false;
  }
  
  // Check permissions field
  if ('permissions' in fm) {
    // Universal uses object
    if (typeof fm.permissions === 'object' && fm.permissions !== null) {
      return true;
    }
  }
  
  // Check for platform-specific exclusive fields
  const platformExclusiveFields = [
    'permissionMode',  // Claude
    'hooks',           // Claude
    'skills',          // Claude
    'temperature',     // OpenCode
    'maxSteps',        // OpenCode
    'disabled'         // OpenCode
  ];
  
  for (const field of platformExclusiveFields) {
    if (field in fm) {
      // Has platform-specific field - not universal
      return false;
    }
  }
  
  // No clear indicators - assume universal
  return true;
}

/**
 * Validate merged package structure
 * 
 * Checks for:
 * - No duplicate paths remaining
 * - All files have content or frontmatter
 * - Paths are valid
 * 
 * @param files - Merged file array
 * @returns Validation result
 */
export function validateMergedPackage(files: PackageFile[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check for duplicates
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) {
      errors.push(`Duplicate path after merge: ${file.path}`);
    }
    paths.add(file.path);
  }
  
  // Check file validity
  for (const file of files) {
    // Check path is non-empty
    if (!file.path || file.path.trim() === '') {
      errors.push('File with empty path found');
      continue;
    }
    
    // Check file has either content or frontmatter
    if (!file.content && !file.frontmatter) {
      warnings.push(`File ${file.path} has no content or frontmatter`);
    }
    
    // Check for absolute paths (should be relative)
    if (file.path.startsWith('/')) {
      warnings.push(`File has absolute path: ${file.path}`);
    }
  }
  
  const valid = errors.length === 0;
  
  if (!valid) {
    logger.error('Merged package validation failed', { errors, warnings });
  } else if (warnings.length > 0) {
    logger.warn('Merged package validation warnings', { warnings });
  }
  
  return {
    valid,
    errors,
    warnings
  };
}

/**
 * Get statistics about merged package
 * 
 * @param files - Merged file array
 * @returns Package statistics
 */
export function getMergedPackageStats(files: PackageFile[]): {
  totalFiles: number;
  filesWithFrontmatter: number;
  filesWithContent: number;
  uniquePaths: number;
} {
  const paths = new Set<string>();
  let filesWithFrontmatter = 0;
  let filesWithContent = 0;
  
  for (const file of files) {
    paths.add(file.path);
    
    if (file.frontmatter && Object.keys(file.frontmatter).length > 0) {
      filesWithFrontmatter++;
    }
    
    if (file.content && file.content.trim().length > 0) {
      filesWithContent++;
    }
  }
  
  return {
    totalFiles: files.length,
    filesWithFrontmatter,
    filesWithContent,
    uniquePaths: paths.size
  };
}
