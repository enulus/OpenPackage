import { join, basename, dirname } from 'path';
import {
  getPlatformDefinition,
  getDetectedPlatforms,
  getAllPlatforms,
  getPlatformDirectoryPathsForPlatform,
  getWorkspaceExt,
  getPackageExt,
  isExtAllowed,
  type Platform,
  type PlatformPaths
} from '../core/platforms.js';
import { logger } from './logger.js';
import { type UniversalSubdir } from '../constants/index.js';
import { normalizePathForProcessing, findSubpathIndex } from './path-normalization.js';

/**
 * Normalize platform names from command line input
 */
export function normalizePlatforms(platforms?: string[]): string[] | undefined {
  if (!platforms || platforms.length === 0) {
    return undefined;
  }
  
  return platforms.map(p => p.toLowerCase());
}

/**
 * Platform Mapper Module
 * Unified functions for mapping between universal subdirs and platform-specific paths
 */

/**
 * Map a universal file path to platform-specific directory and file paths
 */
export function mapUniversalToPlatform(
  platform: Platform,
  subdir: string,
  relPath: string,
  cwd?: string
): { absDir: string; absFile: string } {
  const definition = getPlatformDefinition(platform, cwd);
  const subdirDef = definition.subdirs.get(subdir);

  if (!subdirDef) {
    throw new Error(`Platform ${platform} does not support subdir ${subdir}`);
  }

  // Build the absolute directory path
  const absDir = join(definition.rootDir, subdirDef.path);

  const packageExtMatch = relPath.match(/\.[^.]+$/);
  const packageExt = packageExtMatch?.[0] ?? '';
  const baseName = packageExt ? relPath.slice(0, -packageExt.length) : relPath;
  const targetExt = packageExt ? getWorkspaceExt(subdirDef, packageExt) : '';
  if (targetExt && !isExtAllowed(subdirDef, targetExt)) {
    logger.warn(
      `Skipped ${relPath} for platform ${platform}: extension ${targetExt} is not allowed in ${subdir}`
    );
    throw new Error(
      `Extension ${targetExt} is not allowed for subdir ${subdir} on platform ${platform}`
    );
  }
  const targetFileName = packageExt ? `${baseName}${targetExt}` : relPath;
  const absFile = join(absDir, targetFileName);

  return { absDir, absFile };
}

/**
 * Map a platform-specific file path back to universal subdir and relative path
 * Supports local platform configs via cwd.
 */
export function mapPlatformFileToUniversal(
  absPath: string,
  cwd = process.cwd()
): { platform: Platform; subdir: string; relPath: string } | null {
  const normalizedPath = normalizePathForProcessing(absPath);


  // Check each platform
  for (const platform of getAllPlatforms({ includeDisabled: true }, cwd)) {
    const definition = getPlatformDefinition(platform, cwd);

    // Check each subdir in this platform
    for (const [subdirName, subdirDef] of definition.subdirs.entries()) {
      const subdir = subdirName;
      const platformSubdirPath = join(definition.rootDir, subdirDef.path);

      // Check if the path contains this platform subdir
      const subdirIndex = findSubpathIndex(normalizedPath, platformSubdirPath);
      if (subdirIndex !== -1) {
        // Extract the relative path within the subdir
        // Find where the subdir ends (either /subdir/ or subdir/)
        const absPattern = `/${platformSubdirPath}/`;
        const relPattern = `${platformSubdirPath}/`;
        const isAbsPattern = normalizedPath.indexOf(absPattern) !== -1;

        const patternLength = isAbsPattern ? absPattern.length : relPattern.length;
        const relPathStart = subdirIndex + patternLength;

        let relPath = normalizedPath.substring(relPathStart);

        const workspaceExtMatch = relPath.match(/\.[^.]+$/);
        if (workspaceExtMatch) {
          const workspaceExt = workspaceExtMatch[0];
          const packageExt = getPackageExt(subdirDef, workspaceExt);
          if (packageExt !== workspaceExt) {
            relPath = relPath.slice(0, -workspaceExt.length) + packageExt;
          }
        }

        return { platform, subdir, relPath };
      }
    }
  }

  return null;
}

/**
 * Resolve install targets for a universal file across all detected platforms
 */
export async function resolveInstallTargets(
  cwd: string,
  file: { universalSubdir: UniversalSubdir; relPath: string; sourceExt: string }
): Promise<Array<{ platform: Platform; absDir: string; absFile: string }>> {
  const detectedPlatforms = await getDetectedPlatforms(cwd);
  const targets: Array<{ platform: Platform; absDir: string; absFile: string }> = [];

  for (const platform of detectedPlatforms) {
    try {
      const { absDir, absFile } = mapUniversalToPlatform(platform, file.universalSubdir, file.relPath, cwd);
      targets.push({
        platform,
        absDir: join(cwd, absDir),
        absFile: join(cwd, absFile)
      });
    } catch (error) {
      // Skip platforms that don't support this subdir
      continue;
    }
  }

  return targets;
}

/**
 * Get all platform subdirectories for a given platform and working directory
 * Returns dynamic subdirs map for extensibility with custom universal subdirs
 */
export function getAllPlatformSubdirs(
  platform: Platform,
  cwd: string
): PlatformPaths {
  return getPlatformDirectoryPathsForPlatform(platform, cwd)
}

/**
 * Get the appropriate target directory for saving a file based on its registry path
 * Uses platform definitions for scalable platform detection
 */
export function resolveTargetDirectory(targetPath: string, registryPath: string): string {
  const normalized = normalizePathForProcessing(registryPath);
  const dir = dirname(normalized);
  if (!dir || dir === '.' || dir === '') {
    return targetPath;
  }
  return join(targetPath, dir);
}

/**
 * Get the appropriate target file path for saving
 * Handles platform-specific file naming conventions using platform definitions
 */
export function resolveTargetFilePath(targetDir: string, registryPath: string): string {
  const normalized = normalizePathForProcessing(registryPath);
  const fileName = basename(normalized);
  return join(targetDir, fileName || normalized);
}
