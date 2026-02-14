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
import { 
  promptPackageDelete, 
  promptUnpublishConfirmation 
} from '../../utils/prompts.js';
import { formatPathForDisplay, formatFileCount } from '../../utils/formatters.js';
import { logger } from '../../utils/logger.js';
import { Spinner } from '../../utils/spinner.js';
import { ValidationError, PackageNotFoundError } from '../../utils/errors.js';
import { displayUnpublishSuccess } from './unpublish-output.js';
import type { UnpublishOptions, UnpublishResult, UnpublishData } from './unpublish-types.js';

/**
 * Unpublish package from local registry
 */
export async function runLocalUnpublishPipeline(
  packageSpec: string,
  options: UnpublishOptions
): Promise<UnpublishResult> {
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
        console.log(`Only one version exists: ${targetVersion}`);
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
      return await unpublishAllVersions(normalizedName, availableVersions, options);
    } else {
      return await unpublishSpecificVersion(normalizedName, targetVersion!, options);
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
  options: UnpublishOptions
): Promise<UnpublishResult<UnpublishData>> {
  const versionPath = getPackageVersionPath(packageName, version);
  const displayPath = formatPathForDisplay(versionPath);
  
  // Count files before removal
  const fileCount = await countFilesInDirectory(versionPath);
  
  // Confirmation (unless --force)
  if (!options.force) {
    console.log('');
    console.log(`⚠️ About to unpublish (delete) ${packageName}@${version} from local registry`);
    console.log(`   Location: ${displayPath}`);
    console.log(`   Files: ${formatFileCount(fileCount)}`);
    console.log('');
    
    const confirmed = await promptPackageDelete(packageName);
    if (!confirmed) {
      return {
        success: false,
        error: 'Unpublish cancelled by user'
      };
    }
  }
  
  // Remove version directory
  const spinner = new Spinner(`Removing ${packageName}@${version}...`);
  spinner.start();
  
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
  options: UnpublishOptions
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
    console.log('');
    console.log(`⚠️ About to unpublish (delete) ALL ${versions.length} versions of ${packageName}`);
    console.log(`   Location: ${displayPath}`);
    console.log(`   Total files: ${formatFileCount(totalFileCount)}`);
    console.log('');
    
    const confirmed = await promptUnpublishConfirmation(packageName, versions);
    if (!confirmed) {
      return {
        success: false,
        error: 'Unpublish cancelled by user'
      };
    }
  }
  
  // Remove entire package directory
  const spinner = new Spinner(`Removing ${packageName} (${versions.length} versions)...`);
  spinner.start();
  
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
