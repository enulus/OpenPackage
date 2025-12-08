import { join } from 'path';
import * as semver from 'semver';

import { FILE_PATTERNS, DIR_PATTERNS, UNVERSIONED } from '../../constants/index.js';
import type { CommandResult, PushOptions } from '../../types/index.js';
import type { PushPackageResponse } from '../../types/api.js';
import { authManager } from '../auth.js';
import { getCurrentUsername } from '../api-keys.js';
import { applyWorkspacePackageRename } from '../save/workspace-rename.js';
import { resolveScopedNameForPushWithUserScope, isScopedName } from '../scoping/package-scoping.js';
import { renameRegistryPackage } from '../registry/registry-rename.js';
import { ensureRegistryDirectories, listPackageVersions } from '../directory.js';
import { packageManager } from '../package.js';
import type { PackageContext } from '../package-context.js';
import { exists } from '../../utils/fs.js';
import { formatFileSize } from '../../utils/formatters.js';
import { createHttpClient, type HttpClient } from '../../utils/http-client.js';
import { logger } from '../../utils/logger.js';
import { parsePackageInput } from '../../utils/package-name.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { formatVersionLabel, getLatestStableVersion } from '../../utils/package-versioning.js';
import { getLocalPackageDir } from '../../utils/paths.js';
import { promptConfirmation } from '../../utils/prompts.js';
import { Spinner } from '../../utils/spinner.js';
import { showApiKeySignupMessage } from '../../utils/messages.js';
import { createFormDataForUpload, createTarballFromPackage } from '../../utils/tarball.js';
import { PackageNotFoundError, UserCancellationError } from '../../utils/errors.js';

type PushResolutionSource = 'explicit' | 'latest-stable' | 'unversioned';

interface PushResolution {
  pkg: any;
  versionToPush?: string;
  source: PushResolutionSource;
}

class PushError extends Error {
  constructor(
    message: string,
    public readonly code?:
      | 'INVALID_VERSION'
      | 'PRERELEASE_DISALLOWED'
      | 'NO_VERSIONS'
  ) {
    super(message);
    this.name = 'PushError';
  }
}

export interface PushPipelineOptions extends PushOptions {}

export interface PushPipelineResult {
  packageName: string;
  version: string;
  size: number;
  checksum: string;
  registry: string;
  profile: string;
  message?: string;
}

export async function runPushPipeline(
  packageInput: string,
  options: PushPipelineOptions
): Promise<CommandResult<PushPipelineResult>> {
  const cwd = process.cwd();
  const authOptions = { profile: options.profile, apiKey: options.apiKey };
  const { name: parsedName, version: parsedVersion } = parsePackageInput(packageInput);

  let packageNameToPush = parsedName;
  let attemptedVersion: string | undefined;

  try {
    logger.info(`Pushing package '${packageInput}' to remote registry`, { options });
    await ensureRegistryDirectories();

    if (!(await packageManager.packageExists(packageNameToPush))) {
      console.error(`❌ Package '${packageNameToPush}' not found in local registry`);
      return { success: false, error: 'Package not found' };
    }

    await authManager.validateAuth(authOptions);
    packageNameToPush = await ensureScopedPackageName(cwd, packageNameToPush, authOptions);

    const { pkg, versionToPush } = await resolvePushResolution(packageNameToPush, parsedVersion);
    attemptedVersion = versionToPush;

    validateUploadVersion(versionToPush);

    const httpClient = await createHttpClient(authOptions);

    const registryUrl = authManager.getRegistryUrl();
    const profile = authManager.getCurrentProfile(authOptions);
    const versionLabel = formatVersionLabel(versionToPush);

    logPushSummary(packageNameToPush, versionLabel, profile, pkg);

    const tarballInfo = await createPackageTarball(pkg);
    const response = await uploadPackage(httpClient, packageNameToPush, versionToPush, tarballInfo);

    printPushSuccess(response, tarballInfo);

    return {
      success: true,
      data: {
        packageName: response.package.name,
        version: response.version.version ?? UNVERSIONED,
        size: tarballInfo.size,
        checksum: tarballInfo.checksum,
        registry: registryUrl,
        profile,
        message: response.message
      }
    };
  } catch (error) {
    return handlePushError(error, packageNameToPush, attemptedVersion, parsedVersion);
  }
}

async function ensureScopedPackageName(
  cwd: string,
  packageName: string,
  authOptions: PushOptions
): Promise<string> {
  if (isScopedName(packageName)) {
    return packageName;
  }

  const username = await getCurrentUsername(authOptions);
  const scopedName = await resolveScopedNameForPushWithUserScope(packageName, username, authOptions.profile);

  await renameRegistryPackage(packageName, scopedName);
  await tryRenameWorkspacePackage(cwd, packageName, scopedName);

  return scopedName;
}

async function resolvePushResolution(
  packageName: string,
  parsedVersion?: string
): Promise<PushResolution> {
  if (parsedVersion) {
    return resolveExplicitPush(packageName, parsedVersion);
  }

  return resolveImplicitPush(packageName, async (latest) => {
    const proceed = await promptConfirmation(`Push latest stable version '${latest}'?`, true);
    if (!proceed) {
      throw new UserCancellationError('User declined pushing the stable version');
    }
  });
}

async function resolveExplicitPush(packageName: string, parsedVersion: string): Promise<PushResolution> {
  assertStableSemver(parsedVersion);
  const pkg = await packageManager.loadPackage(packageName, parsedVersion);
  logVersionMismatch(packageName, parsedVersion, pkg.metadata.version);
  const effectiveVersion = pkg.metadata.version ?? parsedVersion;
  return { pkg, versionToPush: effectiveVersion, source: 'explicit' };
}

async function resolveImplicitPush(
  packageName: string,
  onConfirmLatest: (latest: string) => Promise<void>
): Promise<PushResolution> {
  const allVersions = await listPackageVersions(packageName);
  const latestStable = getLatestStableVersion(allVersions);

  if (latestStable) {
    await onConfirmLatest(latestStable);
    const pkg = await packageManager.loadPackage(packageName, latestStable);
    const effectiveVersion = pkg.metadata.version ?? latestStable;
    return { pkg, versionToPush: effectiveVersion, source: 'latest-stable' };
  }

  if (allVersions.includes(UNVERSIONED)) {
    const pkg = await packageManager.loadPackage(packageName, UNVERSIONED);
    const effectiveVersion = pkg.metadata.version ?? UNVERSIONED;
    return { pkg, versionToPush: effectiveVersion, source: 'unversioned' };
  }

  throw new PushError(
    `No versions found for package '${packageName}'. Create a package with "opkg pack <package>" or ensure package.yml exists.`,
    'NO_VERSIONS'
  );
}

function validateUploadVersion(uploadVersion?: string): void {
  if (!uploadVersion) {
    return;
  }

  assertStableSemver(uploadVersion);
}

function assertStableSemver(version: string): void {
  if (!semver.valid(version)) {
    throw new PushError(`Invalid version: ${version}. Provide a valid semver version.`, 'INVALID_VERSION');
  }
  if (semver.prerelease(version)) {
    throw new PushError(`Prerelease versions cannot be pushed: ${version}`, 'PRERELEASE_DISALLOWED');
  }
}

function logVersionMismatch(packageName: string, requested: string, manifestVersion?: string): void {
  if (manifestVersion && manifestVersion !== requested) {
    logger.warn('Version mismatch between manifest and requested push', {
      packageName,
      manifestVersion,
      requested
    });
  }
}

function logPushSummary(packageName: string, versionLabel: string, profile: string, pkg: any): void {
  console.log(`✓ Pushing package '${packageName}' to remote registry...`);
  console.log(`✓ Version: ${versionLabel}`);
  console.log(`✓ Profile: ${profile}`);
  console.log('');
  console.log('✓ Package validation complete');
  console.log(`  • Name: ${pkg.metadata.name}`);
  console.log(`  • Version: ${versionLabel}`);
  console.log(`  • Description: ${pkg.metadata.description || '(no description)'}`);
  console.log(`  • Files: ${pkg.files.length}`);
}

async function createPackageTarball(pkg: any) {
  console.log('✓ Creating tarball...');
  const tarballInfo = await createTarballFromPackage(pkg);
  console.log(`✓ Created tarball (${pkg.files.length} files, ${formatFileSize(tarballInfo.size)})`);
  return tarballInfo;
}

async function uploadPackage(
  httpClient: HttpClient,
  packageName: string,
  uploadVersion: string | undefined,
  tarballInfo: Awaited<ReturnType<typeof createTarballFromPackage>>
): Promise<PushPackageResponse> {
  const formData = createFormDataForUpload(packageName, uploadVersion, tarballInfo);
  const uploadSpinner = new Spinner('Uploading to registry...');
  uploadSpinner.start();
  try {
    return await httpClient.uploadFormData<PushPackageResponse>('/packages/push', formData);
  } finally {
    uploadSpinner.stop();
  }
}

function printPushSuccess(
  response: PushPackageResponse,
  tarballInfo: Awaited<ReturnType<typeof createTarballFromPackage>>
): void {
  console.log('✓ Push successful');
  console.log('');
  console.log('✓ Package Details:');
  console.log(`  • Name: ${response.package.name}`);
  console.log(`  • Version: ${response.version.version ?? UNVERSIONED}`);
  console.log(`  • Size: ${formatFileSize(tarballInfo.size)}`);
  const keywords = Array.isArray(response.package.keywords) ? response.package.keywords : [];
  if (keywords.length > 0) {
    console.log(`  • Keywords: ${keywords.join(', ')}`);
  }
  console.log(`  • Private: ${response.package.isPrivate ? 'Yes' : 'No'}`);
  console.log(`  • Created: ${new Date(response.version.createdAt).toLocaleString()}`);
}

async function tryRenameWorkspacePackage(
  cwd: string,
  oldName: string,
  newName: string
): Promise<void> {
  try {
    const packageRootDir = getLocalPackageDir(cwd, oldName);
    const packageYmlPath = join(packageRootDir, DIR_PATTERNS.OPENPACKAGE, FILE_PATTERNS.PACKAGE_YML);

    if (!(await exists(packageYmlPath))) {
      return;
    }

    const config = await parsePackageYml(packageYmlPath);

    const packageContext: PackageContext = {
      name: config.name,
      version: config.version,
      config,
      packageYmlPath,
      packageRootDir,
      packageFilesDir: join(packageRootDir, DIR_PATTERNS.OPENPACKAGE),
      location: 'nested',
      isCwdPackage: false,
      isNew: false
    };

    await applyWorkspacePackageRename(cwd, packageContext, newName);
    console.log(`✓ Updated workspace package name: ${oldName} → ${newName}`);
  } catch (error) {
    logger.debug('Workspace package rename skipped', {
      oldName,
      newName,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function handlePushError(
  error: unknown,
  packageName: string,
  attemptedVersion?: string,
  requestedVersion?: string
): CommandResult<PushPipelineResult> {
  logger.debug('Push pipeline failed', { error, packageName });

  if (error instanceof UserCancellationError) {
    throw error;
  }

  if (error instanceof PackageNotFoundError) {
    const versionLabel = requestedVersion ?? attemptedVersion ?? 'requested version';
    console.error(`❌ Version ${versionLabel} not found for package '${packageName}'`);
    console.log('💡 Create this stable version using "opkg pack <package>" and push again.');
    return { success: false, error: 'Version not found' };
  }

  if (error instanceof PushError) {
    if (error.code === 'INVALID_VERSION') {
      console.error(`❌ ${error.message}`);
      return { success: false, error: 'Invalid version' };
    }
    if (error.code === 'PRERELEASE_DISALLOWED') {
      console.error(`❌ ${error.message}`);
      console.log('Only stable versions (x.y.z) can be pushed to the remote registry.');
      console.log('💡 Create a stable version using "opkg pack <package>".');
      return { success: false, error: 'Only stable versions can be pushed' };
    }
    if (error.code === 'NO_VERSIONS') {
      console.error(`❌ ${error.message}`);
      return { success: false, error: 'Version not found' };
    }

    console.error(`❌ ${error.message}`);
    return { success: false, error: error.message };
  }

  if (error instanceof Error) {
    const apiError = (error as any).apiError;

    if (apiError?.statusCode === 409) {
      console.error(`❌ Version ${attemptedVersion || 'latest'} already exists for package '${packageName}'`);
      console.log('💡 Try one of these options:');
      console.log('  • Increment version with command "opkg pack <package>"');
      console.log('  • Update version with command "opkg pack <package>@<version>"');
      console.log('  • Specify a version explicitly using <package>@<version>');
      return { success: false, error: 'Version already exists' };
    }

    if (apiError?.statusCode === 401) {
      console.error(`❌ Authentication failed: ${error.message}`);
      showApiKeySignupMessage();
      console.log('💡 To configure authentication:');
      console.log('  opkg configure');
      console.log('  opkg configure --profile <name>');
      return { success: false, error: 'Authentication failed' };
    }

    if (apiError?.statusCode === 403) {
      console.error(`❌ Access denied: ${error.message}`);
      showApiKeySignupMessage();
      console.log('💡 To configure authentication:');
      console.log('  opkg configure');
      console.log('  opkg configure --profile <name>');
      return { success: false, error: 'Access denied' };
    }

    if (apiError?.statusCode === 422) {
      console.error(`❌ Package validation failed: ${error.message}`);
      if (apiError.details) {
        console.log('Validation errors:');
        if (Array.isArray(apiError.details)) {
          apiError.details.forEach((detail: any) => {
            console.log(`  • ${detail.message || detail}`);
          });
        } else {
          console.log(`  • ${apiError.details}`);
        }
      }
      return { success: false, error: 'Validation failed' };
    }

    if (error.message.includes('timeout')) {
      console.log('💡 The upload may have timed out. You can:');
      console.log('  • Try again (the upload may have succeeded)');
      console.log('  • Check your internet connection');
      console.log('  • Set OPENPACKAGEAPI_TIMEOUT environment variable for longer timeout');
    }

    return { success: false, error: error.message };
  }

  return { success: false, error: 'Unknown error occurred' };
}


