import path from 'path';
import * as semver from 'semver';

import { FILE_PATTERNS } from '../../constants/index.js';
import { authManager } from '../auth.js';
import { getCurrentUsername } from '../api-keys.js';
import { resolveScopedNameForPushWithUserScope, isScopedName } from '../scoping/package-scoping.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { readPackageFilesForRegistry } from '../../utils/package-copy.js';
import { createHttpClient } from '../../utils/http-client.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import type { Package } from '../../types/index.js';
import { handlePublishError, PublishError } from './publish-errors.js';
import { logPublishSummary, printPublishSuccess } from './publish-output.js';
import { preparePackageForUpload, createPublishTarball, uploadPackage } from './publish-upload.js';
import type { PublishOptions, PublishResult } from './publish-types.js';

async function resolveUploadName(
  packageName: string,
  authOptions: PublishOptions
): Promise<string> {
  if (isScopedName(packageName)) {
    return packageName;
  }

  const username = await getCurrentUsername(authOptions);
  return await resolveScopedNameForPushWithUserScope(packageName, username, authOptions.profile);
}

function validateVersion(version?: string): void {
  if (!version) {
    throw new PublishError(
      'openpackage.yml must contain a version field to publish',
      'MISSING_VERSION'
    );
  }

  if (!semver.valid(version)) {
    throw new PublishError(
      `Invalid version: ${version}. Provide a valid semver version.`,
      'INVALID_VERSION'
    );
  }

  if (semver.prerelease(version)) {
    throw new PublishError(
      `Prerelease versions cannot be published: ${version}`,
      'PRERELEASE_DISALLOWED'
    );
  }
}

export async function runPublishPipeline(
  options: PublishOptions
): Promise<PublishResult> {
  const cwd = process.cwd();
  let uploadPackageName: string | undefined;
  let version: string | undefined;

  try {
    // Check if openpackage.yml exists in CWD
    const manifestPath = path.join(cwd, FILE_PATTERNS.OPENPACKAGE_YML);
    if (!(await exists(manifestPath))) {
      console.error('❌ No openpackage.yml found in current directory');
      console.error('   Run this command from a package root directory');
      return {
        success: false,
        error: 'No openpackage.yml found in current directory'
      };
    }

    // Parse manifest
    const manifest = await parsePackageYml(manifestPath);
    const localPackageName = manifest.name;
    version = manifest.version;

    if (!localPackageName) {
      throw new PublishError(
        'openpackage.yml must contain a name field',
        'MISSING_NAME'
      );
    }

    // Validate version
    validateVersion(version);

    logger.info(`Publishing package '${localPackageName}' from CWD`, { cwd, version });

    // Validate authentication
    await authManager.validateAuth(options);

    // Resolve upload name (add scope if needed)
    uploadPackageName = await resolveUploadName(localPackageName, options);

    // Collect package files
    const files = await readPackageFilesForRegistry(cwd);
    if (files.length === 0) {
      throw new PublishError('No package files found to publish', 'NO_FILES');
    }

    // Create package object
    const pkg: Package = {
      metadata: manifest,
      files
    };

    // Prepare package for upload (update name if scoped)
    const uploadPkg = preparePackageForUpload(pkg, uploadPackageName);

    // Get registry info
    const httpClient = await createHttpClient(options);
    const registryUrl = authManager.getRegistryUrl();
    const profile = authManager.getCurrentProfile(options);

    // Log summary
    logPublishSummary(uploadPackageName, profile, registryUrl);

    // Create tarball
    const tarballInfo = await createPublishTarball(uploadPkg);

    // Upload to registry
    const response = await uploadPackage(httpClient, uploadPackageName, version, tarballInfo);

    // Print success
    printPublishSuccess(response, tarballInfo, registryUrl);

    return {
      success: true,
      data: {
        packageName: response.package.name,
        version: response.version.version ?? version,
        size: tarballInfo.size,
        checksum: tarballInfo.checksum,
        registry: registryUrl,
        profile,
        message: response.message,
      },
    };
  } catch (error) {
    return handlePublishError(error, uploadPackageName, version);
  }
}
