import type { PushPackageResponse } from '../../types/api.js';
import type { TarballInfo } from '../../utils/tarball.js';
import { formatFileSize } from '../../utils/formatters.js';

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
