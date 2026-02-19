/**
 * Metadata extraction for view command output.
 * Separated to avoid circular dependencies between list-printers and remote-list-resolver.
 */

import type { PackageYml, PackageRepository } from '../../types/index.js';

export interface ViewMetadataEntry {
  key: string;
  value: string | boolean | string[];
}

/** Extract recognized manifest metadata for display (excludes dependencies) */
export function extractMetadataFromManifest(manifest: Partial<PackageYml>): ViewMetadataEntry[] {
  const entries: ViewMetadataEntry[] = [];
  const push = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') {
      entries.push({ key, value: value as string | boolean | string[] });
    }
  };
  push('name', manifest.name);
  push('version', manifest.version);
  push('description', manifest.description);
  push('keywords', manifest.keywords);
  push('author', manifest.author);
  push('license', manifest.license);
  push('homepage', manifest.homepage);
  if (manifest.repository) {
    const repo = manifest.repository as PackageRepository;
    const repoStr = repo.directory ? `${repo.url} (${repo.directory})` : repo.url;
    push('repository', repoStr);
  }
  if (manifest.private === true) push('private', true);
  if (manifest.partial === true) push('partial', true);
  return entries;
}
