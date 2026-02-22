import { join } from 'path';
import { exists, isDirectory } from '../../utils/fs.js';
import {
  getPlatformDefinition,
  getDetectedPlatforms,
  isUniversalSubdirPath,
  deriveRootDirFromFlows,
  type Platform
} from '../../core/platforms.js';
import type { DiscoveredFile } from '../../types/index.js';

import { discoverFiles } from './file-discovery.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { WORKSPACE_DISCOVERY_EXCLUDES } from '../../constants/workspace.js';
import { DIR_PATTERNS } from '../../constants/index.js';

/**
 * Process platform subdirectories (rules/commands/agents) within a base directory
 * Uses flows to discover platform-specific directories
 * 
 * TODO: Implement full flow-based discovery
 * For now, discover all files under platform rootDir
 */
async function discoverPlatformFiles(
  cwd: string,
  platform: Platform,
  packageName: string
): Promise<DiscoveredFile[]> {
  const definition = getPlatformDefinition(platform);
  const allFiles: DiscoveredFile[] = [];

  // Discover files from export flows (package → workspace)
  if (definition.export && definition.export.length > 0) {
    // Extract unique directories from export flows 'to' patterns
    const platformDirs = new Set<string>();
    
    for (const flow of definition.export) {
      const toPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0];
      if (toPattern) {
        // Extract directory from pattern (e.g., ".cursor/rules/{name}.mdc" -> "rules")
        const parts = toPattern.split('/');
        if (parts.length > 1) {
          // Get the directory component after rootDir
          const subdir = parts.slice(1, -1).join('/') || parts[1];
          if (subdir) {
            platformDirs.add(subdir);
          }
        }
      }
    }

    // Discover files in each platform directory
    for (const subdir of platformDirs) {
      const rootDir = deriveRootDirFromFlows(definition);
      const subdirPath = join(cwd, rootDir, subdir);
      
      if (await exists(subdirPath) && await isDirectory(subdirPath)) {
        const files = await discoverFiles(subdirPath, packageName, {
          platform,
          registryPathPrefix: `${DIR_PATTERNS.OPENPACKAGE}/${subdir}`,
          sourceDirLabel: platform,
          fileExtensions: [] // Allow all extensions (flows handle filtering)
        });
        allFiles.push(...files);
      }
    }
  }

  return allFiles;
}

/**
 * Dedupe discovered files by source fullPath, preferring universal subdirs over ai
 */
function dedupeDiscoveredFilesPreferUniversal(files: DiscoveredFile[]): DiscoveredFile[] {
  const preference = (file: DiscoveredFile): number => {
    // Normalize registry path to use forward slashes for consistent comparison
    const normalizedPath = normalizePathForProcessing(file.registryPath);

    if (isUniversalSubdirPath(normalizedPath)) return 2;
    return 1;
  };

  const map = new Map<string, DiscoveredFile>();
  for (const file of files) {
    const existing = map.get(file.fullPath);
    if (!existing) {
      map.set(file.fullPath, file);
      continue;
    }
    if (preference(file) > preference(existing)) {
      map.set(file.fullPath, file);
    }
  }
  return Array.from(map.values());
}

/**
 * Unified file discovery function that searches platform-specific directories
 */
async function discoverWorkspaceFiles(cwd: string, packageName: string): Promise<DiscoveredFile[]> {
  return await discoverFiles(cwd, packageName, {
    registryPathPrefix: '',
    sourceDirLabel: 'workspace',
    excludeDirs: WORKSPACE_DISCOVERY_EXCLUDES,
    fileExtensions: []
  });
}

export async function discoverPlatformFilesUnified(cwd: string, packageName: string): Promise<DiscoveredFile[]> {
  const detectedPlatforms = await getDetectedPlatforms(cwd);
  const allDiscoveredFiles: DiscoveredFile[] = [];

  // Process all platform configurations in parallel
  const discoveryPromises = detectedPlatforms.map(async (platform) => {
    return discoverPlatformFiles(cwd, platform, packageName);
  });

  const discoveredFiles = await Promise.all(discoveryPromises);
  allDiscoveredFiles.push(...discoveredFiles.flat());

  const workspaceDiscovered = await discoverWorkspaceFiles(cwd, packageName);
  allDiscoveredFiles.push(...workspaceDiscovered);

  return dedupeDiscoveredFilesPreferUniversal(allDiscoveredFiles);
}
