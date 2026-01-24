import { PullPackageResponse } from '../../types/api.js';
import { formatFileSize } from '../../utils/formatters.js';
import { formatVersionLabel } from '../../utils/package-versioning.js';
import { PullPipelineResult } from './pull-types.js';

const UNVERSIONED_LABEL = 'unversioned';

function hasDefinedManifestVersion(response: PullPackageResponse): boolean {
  const manifestVersion = response.version.version;
  return manifestVersion !== undefined && manifestVersion !== null;
}

function getResolvedVersionLabel(
  response: PullPackageResponse,
  versionToPull: string
): string {
  if (!hasDefinedManifestVersion(response)) {
    return UNVERSIONED_LABEL;
  }
  return versionToPull;
}

export function displayPackageInfo(
  response: PullPackageResponse,
  parsedVersion: string | undefined,
  versionToPull: string,
  profile: string
): void {
  const inaccessibleDownloads = (response.downloads ?? []).filter((download: any) => !download.downloadUrl);
  if (inaccessibleDownloads.length > 0) {
    console.log(`⚠️  Skipping ${inaccessibleDownloads.length} downloads:`);
    inaccessibleDownloads.forEach((download: any) => {
      console.log(`  • ${download.name}: not found or insufficient permissions`);
    });
    console.log('');
  }

  console.log('✓ Package found in registry');
  const resolvedVersionLabel = getResolvedVersionLabel(response, versionToPull);
  console.log(`✓ Version: ${parsedVersion ?? 'latest'} (resolved: ${resolvedVersionLabel})`);
  console.log(`✓ Profile: ${profile}`);
  console.log('');
}

export function displayPullResults(
  result: PullPipelineResult,
  response: PullPackageResponse
): void {
  console.log('✓ Pull successful');
  console.log('');
  console.log('✓ Package Details:');
  console.log(`  • Name: ${result.packageName}`);
  const manifestVersion = response.version.version;
  if (hasDefinedManifestVersion(response) && manifestVersion) {
    console.log(`  • Version: ${formatVersionLabel(manifestVersion)}`);
  }
  console.log(`  • Description: ${response.package.description || '(no description)'}`);
  // Only display size if available (omit for GitHub-indexed packages)
  if (result.size > 0) {
    console.log(`  • Size: ${formatFileSize(result.size)}`);
  }
  const keywords = Array.isArray(response.package.keywords) ? response.package.keywords : [];
  if (keywords.length > 0) {
    console.log(`  • Keywords: ${keywords.join(', ')}`);
  }
  console.log(`  • Private: ${result.isPrivate ? 'Yes' : 'No'}`);
  console.log(`  • Files: ${result.files}`);
  if (result.checksum) {
    console.log(`  • Checksum: ${result.checksum.substring(0, 16)}...`);
  }
}


