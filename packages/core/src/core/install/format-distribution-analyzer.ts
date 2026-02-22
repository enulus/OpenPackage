/**
 * Format Distribution Analyzer Module
 * 
 * Analyzes format distribution across files in a package.
 * Determines dominant platforms and package-level format from per-file detections.
 */

import { logger } from '../../utils/logger.js';
import type { FileFormat, PlatformId, SpecialFormat } from './detection-types.js';

/**
 * Format distribution analysis result
 */
export interface FormatDistribution {
  /** Count of files per platform (dynamic keys from platforms.jsonc) */
  counts: Map<PlatformId | SpecialFormat, number>;
  
  /** Percentage of total files per platform */
  percentages: Map<PlatformId | SpecialFormat, number>;
  
  /** Total files analyzed */
  total: number;
  
  /** Platform with highest count (if any) */
  dominant?: PlatformId | SpecialFormat;
  
  /** Dominant platform percentage (if dominant exists) */
  dominantPercentage?: number;
}

/**
 * Analyze format distribution from per-file detections
 * 
 * Counts how many files were detected as each platform format
 * and calculates percentages.
 * 
 * @param fileFormats - Map of file path -> detected format
 * @returns Distribution analysis
 */
export function analyzeFormatDistribution(
  fileFormats: Map<string, FileFormat>
): FormatDistribution {
  const counts = new Map<PlatformId | SpecialFormat, number>();
  const total = fileFormats.size;
  
  // Count files per platform
  for (const [filePath, format] of fileFormats) {
    const platform = format.platform;
    const count = counts.get(platform) || 0;
    counts.set(platform, count + 1);
  }
  
  // Calculate percentages
  const percentages = new Map<PlatformId | SpecialFormat, number>();
  for (const [platform, count] of counts) {
    const percentage = total > 0 ? count / total : 0;
    percentages.set(platform, percentage);
  }
  
  // Find dominant platform
  let dominant: PlatformId | SpecialFormat | undefined;
  let maxCount = 0;
  for (const [platform, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      dominant = platform;
    }
  }
  
  const dominantPercentage = dominant ? percentages.get(dominant) : undefined;
  
  return {
    counts,
    percentages,
    total,
    dominant,
    dominantPercentage
  };
}

/**
 * Calculate overall package confidence from format distribution
 * 
 * Higher confidence when:
 * - All files are the same format
 * - One format is clearly dominant (>70%)
 * - Detected formats have high individual confidence
 * 
 * Lower confidence when:
 * - Many different formats detected
 * - No clear dominant format
 * - Individual file detections have low confidence
 * 
 * @param distribution - Format distribution analysis
 * @param fileFormats - Map of file path -> detected format (for confidence)
 * @returns Overall confidence score (0-1)
 */
export function calculatePackageConfidence(
  distribution: FormatDistribution,
  fileFormats: Map<string, FileFormat>
): number {
  const { counts, percentages, total, dominantPercentage } = distribution;
  
  // No files - zero confidence
  if (total === 0) {
    return 0;
  }
  
  // Single format - use that format's average confidence
  if (counts.size === 1) {
    const avgConfidence = calculateAverageFileConfidence(fileFormats);
    return Math.min(1.0, avgConfidence * 1.1); // Boost for consistency
  }
  
  // Multiple formats - check if one is dominant
  if (dominantPercentage && dominantPercentage > 0.7) {
    // Dominant format exists - moderate confidence
    const avgConfidence = calculateAverageFileConfidence(fileFormats);
    return avgConfidence * 0.85; // Slight penalty for mixed content
  }
  
  // Evenly distributed formats - low confidence
  const avgConfidence = calculateAverageFileConfidence(fileFormats);
  return avgConfidence * 0.6; // Higher penalty for ambiguity
}

/**
 * Calculate average confidence across all file detections
 */
function calculateAverageFileConfidence(
  fileFormats: Map<string, FileFormat>
): number {
  if (fileFormats.size === 0) {
    return 0;
  }
  
  let sum = 0;
  for (const format of fileFormats.values()) {
    sum += format.confidence;
  }
  
  return sum / fileFormats.size;
}

/**
 * Get dominant platform if one exists above threshold
 * 
 * @param distribution - Format distribution analysis
 * @param threshold - Minimum percentage to be considered dominant (default 0.7)
 * @returns Dominant platform ID or null
 */
export function getDominantPlatform(
  distribution: FormatDistribution,
  threshold: number = 0.7
): PlatformId | SpecialFormat | null {
  const { dominant, dominantPercentage } = distribution;
  
  if (!dominant || !dominantPercentage) {
    return null;
  }
  
  if (dominantPercentage >= threshold) {
    return dominant;
  }
  
  return null;
}

/**
 * Check if format distribution indicates mixed format package
 * 
 * A package is considered mixed if:
 * - Multiple platforms detected with no dominant (>70%) platform
 * - At least 20% of files are in a secondary format
 * 
 * @param distribution - Format distribution analysis
 * @returns True if package has mixed formats
 */
export function isMixedFormatDistribution(
  distribution: FormatDistribution
): boolean {
  const { counts, percentages, dominantPercentage } = distribution;
  
  // Single format - not mixed
  if (counts.size <= 1) {
    return false;
  }
  
  // No dominant format - definitely mixed
  if (!dominantPercentage || dominantPercentage < 0.7) {
    return true;
  }
  
  // Check if secondary format is significant (>20%)
  const sortedPercentages = Array.from(percentages.values()).sort((a, b) => b - a);
  if (sortedPercentages.length > 1 && sortedPercentages[1] > 0.2) {
    return true;
  }
  
  return false;
}

/**
 * Determine package format from distribution analysis
 * 
 * Returns the overall package format based on distribution patterns:
 * - Single format → That platform ID
 * - Dominant format (>70%) → That platform ID
 * - Mixed formats → 'mixed'
 * - All unknown → 'unknown'
 * - No schemas matched → 'universal'
 * 
 * @param distribution - Format distribution analysis
 * @returns Package format identifier
 */
export function determinePackageFormat(
  distribution: FormatDistribution
): PlatformId | SpecialFormat {
  const { counts, dominant, dominantPercentage } = distribution;
  
  // No files - unknown
  if (distribution.total === 0) {
    return 'unknown';
  }
  
  // Single format - return that format
  if (counts.size === 1) {
    return Array.from(counts.keys())[0];
  }
  
  // Multiple formats - check for dominant
  if (dominant && dominantPercentage && dominantPercentage > 0.7) {
    // Dominant platform exists
    return dominant;
  }
  
  // Mixed formats with no clear winner
  return 'mixed';
}

/**
 * Group files by their detected platform
 * 
 * @param fileFormats - Map of file path -> detected format
 * @returns Map of platform -> file paths
 */
export function groupFilesByPlatform(
  fileFormats: Map<string, FileFormat>
): Map<PlatformId | SpecialFormat, string[]> {
  const groups = new Map<PlatformId | SpecialFormat, string[]>();
  
  for (const [filePath, format] of fileFormats) {
    const platform = format.platform;
    const group = groups.get(platform) || [];
    group.push(filePath);
    groups.set(platform, group);
  }
  
  return groups;
}

/**
 * Get detailed format breakdown for logging/debugging
 * 
 * @param distribution - Format distribution analysis
 * @returns Human-readable breakdown string
 */
export function formatDistributionSummary(
  distribution: FormatDistribution
): string {
  const { counts, percentages, total, dominant } = distribution;
  
  const lines: string[] = [
    `Total files: ${total}`,
    'Distribution:'
  ];
  
  // Sort by count descending
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  
  for (const [platform, count] of sorted) {
    const percentage = percentages.get(platform) || 0;
    const marker = platform === dominant ? '* ' : '  ';
    lines.push(`${marker}${platform}: ${count} (${(percentage * 100).toFixed(1)}%)`);
  }
  
  if (dominant) {
    lines.push(`Dominant: ${dominant}`);
  }
  
  return lines.join('\n');
}
