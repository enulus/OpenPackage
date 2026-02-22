import type { PushPackageResponse } from '../../types/api.js';
import type { TarballInfo } from '../../utils/tarball.js';
import { formatFileSize, formatPathForDisplay } from '../../utils/formatters.js';
import { formatVersionLabel } from '../../utils/package-versioning.js';
import type { PackageYml } from '../../types/index.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

export function printPublishSuccess(
  response: PushPackageResponse,
  tarballInfo: TarballInfo,
  registryUrl: string,
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
  out.success('Package published successfully!');
  out.info(`Package: ${response.package.name}`);
  
  if (response.version.version) {
    out.info(`Version: ${response.version.version}`);
  }
  
  out.info(`Size: ${formatFileSize(tarballInfo.size)}`);
  out.info(`Checksum: ${tarballInfo.checksum.substring(0, 12)}...`);
  out.info(`Registry: ${registryUrl}`);
  
  if (response.message) {
    out.info(`\n${response.message}`);
  }
}

export function logPublishSummary(packageName: string, profile: string, registryUrl: string, output?: OutputPort): void {
  const out = output ?? resolveOutput();
  out.info(`\nPublishing package '${packageName}'...`);
  out.info(`Profile: ${profile}`);
  out.info(`Registry: ${registryUrl}`);
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
  cwd: string,
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
  const { packageName, version, description, sourcePath, destinationPath, fileCount, isCustomOutput } = info;
  
  // Success header
  out.success(`Published ${packageName}@${formatVersionLabel(version)}`);
  
  // Package details
  if (description) {
    out.success(`Description: ${description}`);
  }
  
  // Source information
  const displaySource = formatPathForDisplay(sourcePath, cwd);
  out.success(`Source: ${displaySource}`);
  
  // Destination information
  const displayDestination = formatPathForDisplay(destinationPath, cwd);
  const destinationType = isCustomOutput ? 'Custom output' : 'Registry';
  out.success(`${destinationType}: ${displayDestination}`);
  
  // File count
  out.success(`Files: ${fileCount}`);
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

