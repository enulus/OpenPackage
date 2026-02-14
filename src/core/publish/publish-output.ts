import type { PushPackageResponse } from '../../types/api.js';
import type { TarballInfo } from '../../utils/tarball.js';
import { formatFileSize, formatPathForDisplay } from '../../utils/formatters.js';
import { formatVersionLabel } from '../../utils/package-versioning.js';
import type { PackageYml } from '../../types/index.js';

export function printPublishSuccess(
  response: PushPackageResponse,
  tarballInfo: TarballInfo,
  registryUrl: string
): void {
  console.log('\n✓ Package published successfully!\n');
  console.log(`Package: ${response.package.name}`);
  
  if (response.version.version) {
    console.log(`Version: ${response.version.version}`);
  }
  
  console.log(`Size: ${formatFileSize(tarballInfo.size)}`);
  console.log(`Checksum: ${tarballInfo.checksum.substring(0, 12)}...`);
  console.log(`Registry: ${registryUrl}`);
  
  if (response.message) {
    console.log(`\n${response.message}`);
  }
}

export function logPublishSummary(packageName: string, profile: string, registryUrl: string): void {
  console.log(`\nPublishing package '${packageName}'...`);
  console.log(`Profile: ${profile}`);
  console.log(`Registry: ${registryUrl}`);
}

/**
 * Result info for local publish operations
 */
export interface PublishResultInfo {
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
 * Display publish operation success (local publishing)
 */
export function displayPublishSuccess(
  info: PublishResultInfo,
  cwd: string
): void {
  const { packageName, version, description, sourcePath, destinationPath, fileCount, isCustomOutput } = info;
  
  // Success header
  console.log(`✓ Published ${packageName}@${formatVersionLabel(version)}`);
  
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
 * Create publish result info from pipeline data
 */
export function createPublishResultInfo(
  packageName: string,
  version: string,
  sourcePath: string,
  destinationPath: string,
  fileCount: number,
  manifest: PackageYml,
  isCustomOutput: boolean,
  destinationExists?: boolean,
  existingFileCount?: number
): PublishResultInfo {
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

