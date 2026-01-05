import { join, basename, dirname, extname } from 'path';
import {
  getPlatformDefinition,
  getDetectedPlatforms,
  getAllPlatforms,
  getPlatformDirectoryPathsForPlatform,
  getWorkspaceExt,
  getPackageExt,
  isExtAllowed,
  type Platform,
  type PlatformPaths,
  type PlatformDefinition
} from '../core/platforms.js';
import { logger } from './logger.js';
import { type UniversalSubdir } from '../constants/index.js';
import { normalizePathForProcessing, findSubpathIndex } from './path-normalization.js';

/**
 * Result of mapping a universal path to a platform path.
 *
 * IMPORTANT CONTRACT:
 * - `relDir` / `relFile` are **workspace-relative** paths (to be joined with the workspace `cwd`)
 *
 * Do NOT return absolute paths from this mapper: most call sites treat mapping outputs as
 * relative and prefix them with `cwd` (via `path.join`), which would create duplicated roots.
 */
export interface PlatformPathMapping {
  /** Workspace-relative directory path (e.g. `.cursor/rules`) */
  relDir: string;
  /** Workspace-relative file path (e.g. `.cursor/rules/foo.mdc`) */
  relFile: string;
}

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
 * 
 * Note: This module currently uses subdirs-based mapping. Flow-based path resolution
 * will be added in a future update (Section 6.4 of platform-flows implementation).
 */

/**
 * Map a universal file path to platform-specific directory and file paths
 * 
 * TODO (Section 6.4): Update to support flow-based path resolution when flows are defined
 */
export function mapUniversalToPlatform(
  platform: Platform,
  subdir: string,
  relPath: string,
  cwd?: string
): PlatformPathMapping {
  const definition = getPlatformDefinition(platform, cwd);
  
  // Use flow-based resolution
  if (definition.flows && definition.flows.length > 0) {
    return mapUniversalToPlatformWithFlows(definition, subdir, relPath);
  }
  
  // No flows defined - should not happen with flows-only system
  throw new Error(`Platform ${platform} does not have flows defined for subdir ${subdir}`);
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


  // Check each platform using flows
  for (const platform of getAllPlatforms({ includeDisabled: true }, cwd)) {
    const definition = getPlatformDefinition(platform, cwd);

    // TODO: Implement full flow-based reverse mapping
    // For now, extract subdirs from flows and do basic mapping
    if (definition.flows && definition.flows.length > 0) {
      for (const flow of definition.flows) {
        const toPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0];
        if (!toPattern) continue;
        
        // Extract directory from 'to' pattern (e.g., ".cursor/rules/{name}.mdc" -> ".cursor/rules")
        const parts = toPattern.split('/');
        const platformSubdirPath = parts.slice(0, -1).join('/');
        
        // Check if the path contains this platform subdir
        const subdirIndex = findSubpathIndex(normalizedPath, platformSubdirPath);
        if (subdirIndex !== -1) {
          // Extract universal subdir from 'from' pattern
          const fromParts = flow.from.split('/');
          const subdir = fromParts[0];
          
          // Extract the relative path within the subdir
          const absPattern = `/${platformSubdirPath}/`;
          const relPattern = `${platformSubdirPath}/`;
          const isAbsPattern = normalizedPath.indexOf(absPattern) !== -1;

          const patternLength = isAbsPattern ? absPattern.length : relPattern.length;
          const relPathStart = subdirIndex + patternLength;

          let relPath = normalizedPath.substring(relPathStart);

          // Handle extension transformations from flow
          const workspaceExtMatch = relPath.match(/\.[^.]+$/);
          const toExtMatch = toPattern.match(/\.[^./]+$/);
          const fromExtMatch = flow.from.match(/\.[^./]+$/);
          
          if (workspaceExtMatch && toExtMatch && fromExtMatch) {
            const workspaceExt = workspaceExtMatch[0];
            const toExt = toExtMatch[0];
            const fromExt = fromExtMatch[0];
            
            if (workspaceExt === toExt && toExt !== fromExt) {
              // Transform back to package extension
              relPath = relPath.slice(0, -workspaceExt.length) + fromExt;
            }
          }

          return { platform, subdir, relPath };
        }
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
      const { relDir, relFile } = mapUniversalToPlatform(platform, file.universalSubdir, file.relPath, cwd);
      targets.push({
        platform,
        absDir: join(cwd, relDir),
        absFile: join(cwd, relFile)
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
 * Map universal path to platform-specific path using flows configuration.
 * Handles glob patterns correctly by resolving them to concrete file paths.
 */
function mapUniversalToPlatformWithFlows(
  definition: PlatformDefinition,
  subdir: string,
  relPath: string
): PlatformPathMapping {
  const flows = definition.flows || [];
  
  // Construct the full source path for matching
  const sourcePath = `${subdir}/${relPath}`;
  
  const candidateFlows = flows.filter(flow => flow.from.startsWith(`${subdir}/`));
  if (candidateFlows.length === 0) {
    throw new Error(`Platform ${definition.id} does not support subdir ${subdir}`);
  }

  // Find a flow that matches this source path
  const matchingFlow = candidateFlows.find(flow => {
    const fromPattern = flow.from;
    
    // Check if the source path matches the pattern
    // Handle glob patterns with ** and *
    if (fromPattern.includes('*')) {
      // Convert glob pattern to regex for matching
      // Use placeholders to prevent replacement interference
      const regexPattern = fromPattern
        .replace(/\./g, '\\.')
        .replace(/\*\*\//g, '___DOUBLESTAR_SLASH___')   // **/ matches zero or more segments
        .replace(/\/\*\*/g, '___SLASH_DOUBLESTAR___')   // /** matches zero or more segments
        .replace(/\*\*/g, '___DOUBLESTAR___')           // ** alone matches anything
        .replace(/\*/g, '[^/]+')                        // * matches filename characters
        .replace(/___DOUBLESTAR_SLASH___/g, '(?:.*/)?' )  // Replace placeholders
        .replace(/___SLASH_DOUBLESTAR___/g, '(?:/.*)?')
        .replace(/___DOUBLESTAR___/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(sourcePath);
    }
    
    // Exact match
    return fromPattern === sourcePath;
  });
  
  if (!matchingFlow) {
    const sourceExt = extname(sourcePath);
    const expectedExts = Array.from(
      new Set(
        candidateFlows
          .map(flow => extname(flow.from))
          .filter(ext => typeof ext === 'string' && ext.length > 0)
      )
    );

    if (sourceExt && expectedExts.length > 0 && !expectedExts.includes(sourceExt)) {
      logger.warn(
        `Skipped ${relPath} for platform ${definition.id}: extension ${sourceExt} does not match flow pattern`,
        { subdir, expectedExts }
      );
      throw new Error(
        `File extension ${sourceExt} is not allowed for subdir ${subdir} on platform ${definition.id}`
      );
    }

    throw new Error(`Platform ${definition.id} does not support path ${sourcePath}`);
  }
  
  const fromPattern = matchingFlow.from;
  const toPattern = matchingFlow.to;
  
  // Get the target path string (handle multi-target by taking first)
  let targetPathPattern: string;
  if (typeof toPattern === 'string') {
    targetPathPattern = toPattern;
  } else {
    // Multi-target flow - use first target
    const targets = toPattern as Record<string, Partial<import('../types/flows.js').Flow>>;
    const firstTargetConfig = Object.values(targets)[0];
    targetPathPattern = typeof firstTargetConfig === 'string' ? firstTargetConfig : (firstTargetConfig as any).to;
    
    if (typeof targetPathPattern !== 'string') {
      throw new Error(`Invalid multi-target flow configuration for platform ${definition.id}`);
    }
  }
  
  // Resolve the target path from the glob pattern
  const targetPath = resolveTargetPathFromGlob(sourcePath, fromPattern, targetPathPattern);

  // Normalize: callers expect workspace-relative paths and will join them with `cwd`.
  const workspaceRoot = normalizePathForProcessing(process.cwd());
  let relTarget = normalizePathForProcessing(targetPath);
  const workspaceRootNoLeading = workspaceRoot.replace(/^\/+/, '');

  // If targetPath accidentally includes the workspace root, strip it back to a workspace-relative path.
  if (relTarget === workspaceRoot) {
    relTarget = '';
  } else if (relTarget.startsWith(`${workspaceRoot}/`)) {
    relTarget = relTarget.slice(workspaceRoot.length + 1);
  } else if (workspaceRootNoLeading && relTarget.startsWith(`${workspaceRootNoLeading}/`)) {
    relTarget = relTarget.slice(workspaceRootNoLeading.length + 1);
  }

  // Ensure it's relative (no leading slash), but keep leading dot dirs like ".claude".
  relTarget = relTarget.replace(/^\/+/, '');

  const relFile = relTarget;
  const relDir = dirname(relFile);

  return { relDir, relFile };
}

/**
 * Resolve target path from glob patterns
 * This implements the same logic as flow-executor's resolveTargetFromGlob
 */
function resolveTargetPathFromGlob(sourcePath: string, fromPattern: string, toPattern: string): string {
  // If 'to' pattern has glob, map the structure
  if (toPattern.includes('*')) {
    // Handle ** recursive patterns
    if (fromPattern.includes('**') && toPattern.includes('**')) {
      // Extract the base directories before **
      const fromParts = fromPattern.split('**');
      const toParts = toPattern.split('**');
      const fromBase = fromParts[0].replace(/\/$/, '');
      const toBase = toParts[0].replace(/\/$/, '');
      
      // Get the file pattern after **
      const fromSuffix = fromParts[1] || '';
      const toSuffix = toParts[1] || '';
      
      // Extract the relative path after the base directory
      let relativeSubpath = sourcePath;
      if (fromBase) {
        relativeSubpath = sourcePath.startsWith(fromBase + '/') 
          ? sourcePath.slice(fromBase.length + 1)
          : sourcePath;
      }
      
      // Handle extension mapping if suffixes specify extensions
      // e.g., /**/*.md -> /**/*.mdc
      if (fromSuffix && toSuffix) {
        const fromExt = fromSuffix.replace(/^\/?\*+/, '');
        const toExt = toSuffix.replace(/^\/?\*+/, '');
        if (fromExt && toExt && fromExt !== toExt) {
          relativeSubpath = relativeSubpath.replace(new RegExp(fromExt.replace('.', '\\.') + '$'), toExt);
        }
      }
      
      // Build target path
      const targetPath = toBase ? join(toBase, relativeSubpath) : relativeSubpath;
      return targetPath;
    }
    
    // Handle single-level * patterns
    const sourceFileName = basename(sourcePath);
    const sourceExt = extname(sourcePath);
    const sourceBase = basename(sourcePath, sourceExt);
    
    const toParts = toPattern.split('*');
    const toPrefix = toParts[0];
    const toSuffix = toParts[1] || '';
    
    const targetExt = toSuffix.startsWith('.') ? toSuffix : (sourceExt + toSuffix);
    const targetFileName = sourceBase + targetExt;
    
    const resolvedTo = toPrefix + targetFileName;
    return resolvedTo;
  }
  
  // Handle {name} placeholder pattern
  if (toPattern.includes('{name}')) {
    const fileName = basename(sourcePath);
    const fileExt = extname(sourcePath);
    const baseName = fileName.slice(0, -fileExt.length);
    
    let targetPath = toPattern.replace('{name}', baseName);
    
    // Check if the target pattern changes the extension
    const targetExt = extname(targetPath);
    
    // If no extension in pattern, preserve original extension
    if (!targetExt && fileExt) {
      targetPath += fileExt;
    }
    
    return targetPath;
  }
  
  // No glob or placeholder in target - use as-is
  return toPattern;
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
