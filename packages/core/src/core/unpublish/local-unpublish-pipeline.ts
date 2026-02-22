import { parsePackageInput, normalizePackageName } from '../../utils/package-name.js';
import { 
  getPackageVersionPath, 
  getPackagePath, 
  listPackageVersions,
  hasPackageVersion,
  findPackageByName,
  cleanupEmptyPackageDirectory
} from '../directory.js';
import { exists, remove, countFilesInDirectory } from '../../utils/fs.js';
import { formatPathForDisplay, formatFileCount } from '../../utils/formatters.js';
import { logger } from '../../utils/logger.js';
import type { OutputPort } from '../ports/output.js';
import type { PromptPort } from '../ports/prompt.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import { ValidationError, PackageNotFoundError } from '../../utils/errors.js';
import { displayUnpublishSuccess } from './unpublish-output.js';
import type { UnpublishOptions, UnpublishResult, UnpublishData } from './unpublish-types.js';

/**
 * Unpublish package from local registry
 */
export async function runLocalUnpublishPipeline(
  packageSpec: string,
  options: UnpublishOptions,
  output?: OutputPort,
  prompt?: PromptPort
): Promise<UnpublishResult> {
  const out = output ?? resolveOutput();
  const prm = prompt ?? resolvePrompt();
  try {
    // Parse package spec (e.g., "my-package@1.0.0" or "my-package")
    const { name, version } = parsePackageInput(packageSpec);
    const normalizedName = normalizePackageName(name);
    
    logger.info('Unpublishing package', { packageName: normalizedName, version, options });
    
    // Verify package exists in registry
    const packageExists = await findPackageByName(normalizedName);
    if (!packageExists) {
      throw new PackageNotFoundError(
        `Package '${normalizedName}' not found in local registry`
      );
    }
    
    // List all available versions
    const availableVersions = await listPackageVersions(normalizedName);
    if (availableVersions.length === 0) {
      throw new ValidationError(
        `Package '${normalizedName}' has no published versions to unpublish`
      );
    }
    
    // Determine target version(s)
    let targetVersion: string | undefined = version;
    let unpublishAll = false;
    
    if (!targetVersion) {
      // No version specified - default to unpublishing ALL versions
      if (availableVersions.length === 1) {
        // Only one version exists - auto-select it
        targetVersion = availableVersions[0];
        out.info(`Only one version exists: ${targetVersion}`);
      } else {
        // Multiple versions - unpublish all (with confirmation)
        unpublishAll = true;
      }
    } else {
      // Version specified - verify it exists
      const versionExists = await hasPackageVersion(normalizedName, targetVersion);
      if (!versionExists) {
        throw new ValidationError(
          `Version ${targetVersion} of package '${normalizedName}' not found in local registry`
        );
      }
    }
    
    // Execute unpublish
    if (unpublishAll) {
      return await unpublishAllVersions(normalizedName, availableVersions, options, out, prm);
    } else {
      return await unpublishSpecificVersion(normalizedName, targetVersion!, options, out, prm);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Local unpublish failed', { error: message });
    
    return {
      success: false,
      error: message
    };
  }
}

/**
 * Unpublish a specific version
 */
async function unpublishSpecificVersion(
  packageName: string,
  version: string,
  options: UnpublishOptions,
  out: OutputPort,
  prm: PromptPort
): Promise<UnpublishResult<UnpublishData>> {
  const versionPath = getPackageVersionPath(packageName, version);
  const displayPath = formatPathForDisplay(versionPath);
  
  // Count files before removal
  const fileCount = await countFilesInDirectory(versionPath);
  
  // Confirmation (unless --force)
  if (!options.force) {
    out.info('');
    out.warn(`About to unpublish (delete) ${packageName}@${version} from local registry`);
    out.info(`   Location: ${displayPath}`);
    out.info(`   Files: ${formatFileCount(fileCount)}`);
    out.info('');
    
    const confirmed = await prm.confirm(
      `Are you sure you want to delete package '${packageName}'? This action cannot be undone.`,
      false
    );
    if (!confirmed) {
      return {
        success: false,
        error: 'Unpublish cancelled by user'
      };
    }
  }
  
  // Remove version directory
  const spinner = out.spinner();
  spinner.start(`Removing ${packageName}@${version}...`);
  
  await remove(versionPath);
  
  spinner.stop();
  
  // Get remaining versions
  const remainingVersions = await listPackageVersions(packageName);
  
  // Clean up empty package directory if no versions remain
  if (remainingVersions.length === 0) {
    await cleanupEmptyPackageDirectory(packageName);
  }
  
  // Display success
  const data: UnpublishData = {
    packageName,
    version,
    path: versionPath,
    versionsRemoved: 1,
    fileCount,
    remainingVersions
  };
  
  displayUnpublishSuccess(data, process.cwd());
  
  logger.info('Package version unpublished successfully', { 
    packageName, 
    version,
    remainingVersions: remainingVersions.length 
  });
  
  return {
    success: true,
    data
  };
}

/**
 * Unpublish all versions of a package
 */
async function unpublishAllVersions(
  packageName: string,
  versions: string[],
  options: UnpublishOptions,
  out: OutputPort,
  prm: PromptPort
): Promise<UnpublishResult<UnpublishData>> {
  const packagePath = getPackagePath(packageName);
  const displayPath = formatPathForDisplay(packagePath);
  
  // Count total files across all versions
  let totalFileCount = 0;
  for (const version of versions) {
    const versionPath = getPackageVersionPath(packageName, version);
    totalFileCount += await countFilesInDirectory(versionPath);
  }
  
  // Confirmation (unless --force)
  if (!options.force) {
    out.info('');
    out.warn(`About to unpublish (delete) ALL ${versions.length} versions of ${packageName}`);
    out.info(`   Location: ${displayPath}`);
    out.info(`   Total files: ${formatFileCount(totalFileCount)}`);
    out.info('');
    
    const confirmed = await prm.confirm(
      `Unpublish ALL ${versions.length} versions of '${packageName}'? This action cannot be undone.`,
      false
    );
    if (!confirmed) {
      return {
        success: false,
        error: 'Unpublish cancelled by user'
      };
    }
  }
  
  // Remove entire package directory
  const spinner = out.spinner();
  spinner.start(`Removing ${packageName} (${versions.length} versions)...`);
  
  await remove(packagePath);
  
  spinner.stop();
  
  // Display success
  const data: UnpublishData = {
    packageName,
    version: undefined, // All versions removed
    path: packagePath,
    versionsRemoved: versions.length,
    fileCount: totalFileCount,
    remainingVersions: []
  };
  
  displayUnpublishSuccess(data, process.cwd());
  
  logger.info('All package versions unpublished successfully', { 
    packageName,
    versionsRemoved: versions.length
  });
  
  return {
    success: true,
    data
  };
}
