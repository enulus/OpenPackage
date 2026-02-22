import { relative, join } from 'path';

import { FILE_PATTERNS } from '../../constants/index.js';
import type { ExecutionContext } from '../../types/index.js';
import type { InputClassification, RegistryClassification, GitClassification } from '../install/orchestrator/types.js';
import { fetchRemotePackageMetadata } from '../remote-pull.js';
import { parseDownloadIdentifier } from '../remote-pull.js';
import { loadPackageFromGit } from '../install/git-package-loader.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { generateGitHubPackageName } from '../../utils/plugin-naming.js';
import { getPackageVersionPath } from '../directory.js';
import type { ListPackageReport, ListFileMapping, ListResourceGroup } from './list-pipeline.js';
import { groupFilesIntoResources } from './list-pipeline.js';
import type { ViewMetadataEntry } from './view-metadata.js';
import { extractMetadataFromManifest } from './view-metadata.js';

export interface RemoteListResult {
  sourceType: 'registry' | 'git';
  sourceLabel: string;
  package: ListPackageReport;
  dependencies: RemoteListDependency[];
  metadata?: ViewMetadataEntry[];
}

export interface RemoteListDependency {
  name: string;
  version: string;
}

export interface RemoteListOptions {
  profile?: string;
  apiKey?: string;
}

export async function resolveRemoteList(
  classification: InputClassification,
  execContext: ExecutionContext,
  options: RemoteListOptions = {}
): Promise<RemoteListResult | null> {
  switch (classification.type) {
    case 'registry':
      return resolveRegistryList(classification, options);
    case 'git':
      return resolveGitList(classification, execContext);
    default:
      return null;
  }
}

async function resolveRegistryList(
  classification: RegistryClassification,
  options: RemoteListOptions
): Promise<RemoteListResult | null> {
  const { packageName, version } = classification;
  if (!packageName) return null;

  const metadataResult = await fetchRemotePackageMetadata(packageName, version, {
    recursive: true,
    profile: options.profile,
    apiKey: options.apiKey
  });

  if (!metadataResult.success) {
    return null;
  }

  const response = metadataResult.response;
  const resolvedVersion = response.version?.version || version || 'latest';
  const versionLabel = version ? `@${version}` : '';
  const sourceLabel = `${packageName}${versionLabel}`;

  const dependencies: RemoteListDependency[] = [];
  const downloads = response.downloads || [];

  for (const download of downloads) {
    if (!download.name) continue;
    try {
      const parsed = parseDownloadIdentifier(download.name);
      if (parsed.packageName !== packageName) {
        dependencies.push({ name: parsed.packageName, version: parsed.version });
      }
    } catch {
      logger.debug(`Failed to parse download identifier: ${download.name}`);
    }
  }

  const totalFiles = downloads.length;
  
  // Try to read file structure and manifest from local cache
  const fileList: ListFileMapping[] = [];
  let resourceGroups: ListResourceGroup[] | undefined;
  let metadata: ViewMetadataEntry[] | undefined;
  
  try {
    const packagePath = getPackageVersionPath(packageName, resolvedVersion);
    if (await exists(packagePath)) {
      const files = await collectFiles(packagePath, packagePath);
      for (const file of files) {
        fileList.push({
          source: file,
          target: file,
          exists: true
        });
      }
      
      // Generate resource groups from file list
      if (fileList.length > 0) {
        resourceGroups = groupFilesIntoResources(fileList);
      }
      
      // Read manifest for metadata
      const { join } = await import('path');
      const manifestPath = join(packagePath, 'openpackage.yml');
      if (await exists(manifestPath)) {
        try {
          const manifest = await parsePackageYml(manifestPath);
          metadata = extractMetadataFromManifest(manifest);
        } catch (e) {
          logger.debug(`Failed to parse cached manifest: ${e}`);
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to read cached package structure for ${packageName}@${resolvedVersion}: ${error}`);
  }
  
  // Fallback: use API response metadata when no manifest available
  if (!metadata || metadata.length === 0) {
    const apiPkg = response.package;
    const fallback: Partial<Parameters<typeof extractMetadataFromManifest>[0]> = {
      name: packageName,
      version: resolvedVersion,
      description: apiPkg?.description,
      keywords: apiPkg?.keywords
    };
    if (apiPkg?.isPrivate) fallback.private = true;
    metadata = extractMetadataFromManifest(fallback);
  }

  return {
    sourceType: 'registry',
    sourceLabel,
    package: {
      name: packageName,
      version: resolvedVersion,
      path: sourceLabel,
      state: 'synced',
      totalFiles,
      existingFiles: totalFiles,
      fileList: fileList.length > 0 ? fileList : undefined,
      resourceGroups,
      dependencies: dependencies.map(d => d.name)
    },
    dependencies,
    metadata
  };
}

async function resolveGitList(
  classification: GitClassification,
  execContext: ExecutionContext
): Promise<RemoteListResult | null> {
  const { gitUrl, gitRef, resourcePath } = classification;
  if (!gitUrl) return null;

  const result = await loadPackageFromGit({
    url: gitUrl,
    ref: gitRef,
    path: resourcePath
  });

  const contentRoot = result.sourcePath;
  const refLabel = gitRef ? `#${gitRef}` : '';
  const pathLabel = resourcePath ? `/${resourcePath}` : '';
  const sourceLabel = `${gitUrl}${refLabel}${pathLabel}`;

  let name = generateGitHubPackageName({ gitUrl, path: resourcePath });
  let version: string | undefined;
  let dependencies: RemoteListDependency[] = [];
  const fileList: ListFileMapping[] = [];

  let metadata: ViewMetadataEntry[] | undefined;
  const manifestPath = join(contentRoot, 'openpackage.yml');
  if (await exists(manifestPath)) {
    try {
      const manifest = await parsePackageYml(manifestPath);
      name = manifest.name || name;
      version = manifest.version;
      metadata = extractMetadataFromManifest(manifest);

      const allDeps = [
        ...(manifest.dependencies || []),
        ...(manifest['dev-dependencies'] || [])
      ];
      dependencies = allDeps.map(dep => ({
        name: dep.name,
        version: dep.version || ''
      }));
    } catch (error) {
      logger.debug(`Failed to parse manifest at ${manifestPath}: ${error}`);
    }
  }

  const files = await collectFiles(contentRoot, contentRoot);
  for (const file of files) {
    fileList.push({
      source: file,
      target: file,
      exists: true
    });
  }
  
  // Generate resource groups from file list
  const resourceGroups = fileList.length > 0 ? groupFilesIntoResources(fileList) : undefined;
  const finalMetadata = metadata ?? extractMetadataFromManifest({ name, version });

  return {
    sourceType: 'git',
    sourceLabel,
    package: {
      name,
      version,
      path: sourceLabel,
      state: 'synced',
      totalFiles: fileList.length,
      existingFiles: fileList.length,
      fileList,
      resourceGroups,
      dependencies: dependencies.map(d => d.name)
    },
    dependencies,
    metadata: finalMetadata
  };
}

/** Manifest and index files excluded from resource listing */
const NON_RESOURCE_FILES = new Set<string>([
  FILE_PATTERNS.OPENPACKAGE_YML,
  FILE_PATTERNS.OPENPACKAGE_INDEX_YML
]);

export async function collectFiles(dir: string, root: string): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isFile()) {
        if (NON_RESOURCE_FILES.has(entry.name)) continue;
        results.push(relative(root, fullPath));
      } else if (entry.isDirectory()) {
        const nested = await collectFiles(fullPath, root);
        results.push(...nested);
      }
    }
  } catch {
    // ignore unreadable directories
  }

  return results.sort();
}
