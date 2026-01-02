/**
 * @fileoverview Display/output logic for the pack command
 * 
 * Handles formatting and displaying pack operation results to the console.
 * Separated from business logic for easy testing and customization.
 */

import { formatPathForDisplay } from '../../utils/formatters.js';
import { formatVersionLabel } from '../../utils/package-versioning.js';
import type { PackageYml } from '../../types/index.js';

export interface PackResultInfo {
  packageName: string;
  version: string;
  description?: string;
  sourcePath: string;
  destinationPath: string;
  fileCount: number;
  isCustomOutput: boolean;
  destinationExists?: boolean;
  existingFileCount?: number;
}

/**
 * Display pack operation summary
 */
export function displayPackSuccess(
  info: PackResultInfo,
  cwd: string
): void {
  const { packageName, version, description, sourcePath, destinationPath, fileCount, isCustomOutput } = info;
  
  // Success header
  console.log(`✓ Packed ${packageName}@${formatVersionLabel(version)}`);
  
  // Package details
  if (description) {
    console.log(`✓ Description: ${description}`);
  }
  
  // Source information
  const displaySource = formatPathForDisplay(sourcePath, cwd);
  console.log(`✓ Source: ${displaySource}`);
  
  // Destination information
  const displayDestination = formatPathForDisplay(destinationPath, cwd);
  const destinationType = isCustomOutput ? 'Custom output' : 'Registry';
  console.log(`✓ ${destinationType}: ${displayDestination}`);
  
  // File count
  console.log(`✓ Files: ${fileCount}`);
}

/**
 * Display dry-run information
 */
export function displayPackDryRun(
  info: PackResultInfo,
  cwd: string
): void {
  const { packageName, version, sourcePath, destinationPath, fileCount, isCustomOutput, destinationExists, existingFileCount } = info;
  
  console.log(`(dry-run) Pack operation preview for ${packageName}@${formatVersionLabel(version)}`);
  
  const displaySource = formatPathForDisplay(sourcePath, cwd);
  console.log(`✓ Source: ${displaySource}`);
  
  const displayDestination = formatPathForDisplay(destinationPath, cwd);
  const destinationType = isCustomOutput ? 'Custom output' : 'Registry';
  console.log(`✓ ${destinationType}: ${displayDestination}`);
  
  if (destinationExists && existingFileCount !== undefined) {
    console.log(`⚠️  Would overwrite existing package (${existingFileCount} file(s))`);
  }
  
  console.log(`✓ Would pack ${fileCount} file(s)`);
}

/**
 * Create pack result info from pipeline data
 */
export function createPackResultInfo(
  packageName: string,
  version: string,
  sourcePath: string,
  destinationPath: string,
  fileCount: number,
  manifest: PackageYml,
  isCustomOutput: boolean,
  destinationExists?: boolean,
  existingFileCount?: number
): PackResultInfo {
  return {
    packageName,
    version,
    description: manifest.description,
    sourcePath,
    destinationPath,
    fileCount,
    isCustomOutput,
    destinationExists,
    existingFileCount
  };
}
