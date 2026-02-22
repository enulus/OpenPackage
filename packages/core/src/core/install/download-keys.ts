import type { PullPackageDownload } from '../../types/api.js';
import { hasPackageVersion } from '../directory.js';
import { parseDownloadIdentifier } from '../remote-pull.js';

/**
 * Create a unique key for a download based on name and version
 */
export function createDownloadKey(name: string, version: string): string {
  return `${name}@${version}`;
}

/**
 * Compute which download keys are missing locally
 */
export async function computeMissingDownloadKeys(downloads: PullPackageDownload[]): Promise<Set<string>> {
  const missingKeys = new Set<string>();

  for (const download of downloads) {
    if (!download?.name) {
      continue;
    }

    try {
      const { packageName: name, version } = parseDownloadIdentifier(download.name);
      if (!version) {
        continue;
      }

      const existsLocally = await hasPackageVersion(name, version);
      if (!existsLocally) {
        missingKeys.add(createDownloadKey(name, version));
      }
    } catch (error) {
      // Skip download due to invalid name
    }
  }

  return missingKeys;
}
