import { PullPackageResponse } from '../../types/api.js';
import { formatFileSize } from '../../utils/formatters.js';
import { PullPipelineResult } from './pull-types.js';

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
  console.log(`✓ Version: ${parsedVersion ?? 'latest'} (resolved: ${versionToPull})`);
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
  console.log(`  • Version: ${result.version}`);
  console.log(`  • Description: ${response.package.description || '(no description)'}`);
  console.log(`  • Size: ${formatFileSize(result.size)}`);
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


