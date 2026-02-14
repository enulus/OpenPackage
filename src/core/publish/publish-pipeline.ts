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
import type { Package, PackageYml } from '../../types/index.js';
import { handlePublishError, PublishError } from './publish-errors.js';
import { logPublishSummary, printPublishSuccess } from './publish-output.js';
import { preparePackageForUpload, createPublishTarball, uploadPackage } from './publish-upload.js';
import type { PublishOptions, PublishResult } from './publish-types.js';
import { runLocalPublishPipeline } from './local-publish-pipeline.js';
import { classifyPackageInput } from '../../utils/package-input.js';
import { resolvePackageByName } from '../../utils/package-name-resolution.js';
import { ValidationError } from '../../utils/errors.js';
import { formatPathForDisplay } from '../../utils/formatters.js';

/**
 * Main publish pipeline - routes to local or remote based on options
 */
export async function runPublishPipeline(
  packageInput: string | undefined,
  options: PublishOptions
): Promise<PublishResult<any>> {
  // Route to appropriate pipeline
  if (options.local) {
    return await runLocalPublishPipeline(packageInput, options);
  } else {
    return await runRemotePublishPipeline(packageInput, options);
  }
}

interface ResolvedSource {
  name: string;
  version: string;
  packageRoot: string;
  manifest: PackageYml;
}

/**
 * Resolve the source package for publishing (adapted from pack-pipeline)
 * Supports: CWD (default), package names, and directory paths
 * Does NOT support: tarballs or git URLs (remote publish needs source files)
 */
async function resolveSource(
  cwd: string,
  packageInput?: string
): Promise<ResolvedSource> {
  // No package input provided - publish CWD as package
  if (!packageInput) {
    const manifestPath = path.join(cwd, FILE_PATTERNS.OPENPACKAGE_YML);
    if (!(await exists(manifestPath))) {
      throw new Error('No openpackage.yml found in current directory; specify a package name or run inside a package root.');
    }
    const manifest = await parsePackageYml(manifestPath);
    return {
      name: manifest.name,
      version: manifest.version ?? '',
      packageRoot: cwd,
      manifest
    };
  }

  // Classify the input to determine if it's a path, tarball, or package name
  const classification = await classifyPackageInput(packageInput, cwd);

  let packageRoot: string;

  // Handle different input types
  if (classification.type === 'directory') {
    // Direct path to package directory
    packageRoot = classification.resolvedPath!;
    logger.info('Resolved package input as directory path', { path: packageRoot });
  } else if (classification.type === 'tarball') {
    // Tarball input is not supported for remote publish
    throw new ValidationError(
      `Remote publish does not support tarball inputs.\n` +
      `To publish from a tarball, first extract it to a directory, or use local publish mode.`
    );
  } else if (classification.type === 'git') {
    // Git input is not supported for remote publish
    throw new ValidationError(
      `Remote publish does not support git inputs.\n` +
      `To publish from a git repository, first clone it to a directory.`
    );
  } else {
    // Registry type or package name - use name resolution
    // Priority: CWD (if name matches) → Workspace → Global
    // Skip registry (already immutable/published)
    const resolution = await resolvePackageByName({
      cwd,
      packageName: packageInput,
      checkCwd: true,           // Check if CWD is the package (highest priority)
      searchWorkspace: true,    // Search workspace packages
      searchGlobal: true,       // Search global packages
      searchRegistry: false     // Skip registry (already published/immutable)
    });

    if (!resolution.found || !resolution.path) {
      throw new Error(
        `Package '${packageInput}' not found.\n` +
        `Searched: current directory, workspace packages (.openpackage/packages/), and global packages (~/.openpackage/packages/).\n` +
        `Make sure the package exists in one of these locations.`
      );
    }

    packageRoot = resolution.path;

    // Log resolution info for debugging/transparency
    if (resolution.resolutionInfo) {
      const { selected, reason } = resolution.resolutionInfo;
      logger.info('Resolved package for publishing', {
        packageInput,
        selectedSource: selected.type,
        version: selected.version,
        path: selected.path,
        reason
      });

      // User-friendly message about where package was found
      const sourceLabel = selected.type === 'cwd' ? 'current directory' :
                         selected.type === 'workspace' ? 'workspace packages' :
                         selected.type === 'global' ? 'global packages' : selected.type;
      console.log(`✓ Found ${packageInput} in ${sourceLabel}`);
    }
  }

  // Load manifest from resolved path
  const manifestPath = path.join(packageRoot, FILE_PATTERNS.OPENPACKAGE_YML);
  if (!(await exists(manifestPath))) {
    throw new Error(`openpackage.yml not found at ${manifestPath}`);
  }

  const manifest = await parsePackageYml(manifestPath);

  return {
    name: manifest.name,
    version: manifest.version ?? '',
    packageRoot,
    manifest
  };
}

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

async function runRemotePublishPipeline(
  packageInput: string | undefined,
  options: PublishOptions
): Promise<PublishResult> {
  const cwd = process.cwd();
  let uploadPackageName: string | undefined;
  let version: string | undefined;

  try {
    // Resolve source package (supports CWD, package names, and directory paths)
    const source = await resolveSource(cwd, packageInput);

    if (!source.name) {
      throw new PublishError(
        'openpackage.yml must contain a name field',
        'MISSING_NAME'
      );
    }

    // Validate version
    validateVersion(source.version);
    version = source.version;

    logger.info(`Publishing package '${source.name}' from ${source.packageRoot}`, { 
      packageRoot: source.packageRoot, 
      version 
    });

    // Validate authentication
    await authManager.validateAuth(options);

    // Resolve upload name (add scope if needed)
    uploadPackageName = await resolveUploadName(source.name, options);

    // Collect package files from resolved package root
    const files = await readPackageFilesForRegistry(source.packageRoot);
    if (files.length === 0) {
      throw new PublishError('No package files found to publish', 'NO_FILES');
    }

    // Create package object
    const pkg: Package = {
      metadata: source.manifest,
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

    // Print enhanced success message with pack-style formatting
    printPublishSuccessEnhanced(
      response,
      tarballInfo,
      registryUrl,
      profile,
      source,
      files.length,
      cwd
    );

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

/**
 * Print enhanced success message combining pack-style formatting with remote publish info
 */
function printPublishSuccessEnhanced(
  response: any,
  tarballInfo: any,
  registryUrl: string,
  profile: string,
  source: ResolvedSource,
  fileCount: number,
  cwd: string
): void {
  console.log(`\n✓ Published ${source.name}@${source.version} to remote registry\n`);
  
  // Package description if available
  if (source.manifest.description) {
    console.log(`✓ Description: ${source.manifest.description}`);
  }
  
  // Source path
  const displaySource = formatPathForDisplay(source.packageRoot, cwd);
  console.log(`✓ Source: ${displaySource}`);
  
  // Registry destination
  console.log(`✓ Registry: ${registryUrl}`);
  console.log(`✓ Profile: ${profile}`);
  
  // File count
  console.log(`✓ Files: ${fileCount}`);
  
  // Size and checksum (remote-specific)
  const formatFileSize = (bytes: number): string => {
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };
  
  console.log(`✓ Size: ${formatFileSize(tarballInfo.size)}`);
  console.log(`✓ Checksum: ${tarballInfo.checksum.substring(0, 12)}...`);
  
  // Success message from server
  if (response.message) {
    console.log(`\n${response.message}`);
  }
}
