import { join, basename, dirname, extname, relative, resolve } from 'path';
import { realpathSync } from 'fs';
import {
  getPlatformDefinition,
  getDetectedPlatforms,
  getAllPlatforms,
  getPlatformDirectoryPathsForPlatform,
  type Platform,
  type PlatformPaths,
  type PlatformDefinition
} from '../core/platforms.js';
import type { Flow } from '../types/flows.js';
import { logger } from './logger.js';
import { type UniversalSubdir } from '../constants/index.js';
import { normalizePathForProcessing, findSubpathIndex } from './path-normalization.js';

/**
 * Extract pattern string from a flow pattern value
 * Handles both string patterns and FlowPattern objects with { pattern, schema }
 */
function extractPatternString(pattern: string | { pattern: string; schema?: string }): string {
  if (typeof pattern === 'string') {
    return pattern;
  }
  return pattern.pattern;
}

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
 * Resolve the target directory for a registry-relative path within a package directory.
 *
 * This is intentionally simple: it preserves the directory structure of the registry path.
 * (Platform-specific mapping is handled elsewhere via flows.)
 */
export function resolveTargetDirectory(packageDir: string, registryPath: string): string {
  const normalized = registryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (parts.length <= 1) {
    return packageDir;
  }
  return join(packageDir, parts.slice(0, -1).join('/'));
}

/**
 * Resolve the final target file path given a target directory and a registry-relative path.
 */
export function resolveTargetFilePath(targetDir: string, registryPath: string): string {
  const normalized = registryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1] || normalized;
  return join(targetDir, fileName);
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
  
  // Use export flow-based resolution (package → workspace)
  if (definition.export && definition.export.length > 0) {
    return mapUniversalToPlatformWithFlows(definition, subdir, relPath);
  }
  
  // No export flows defined - should not happen with flows-only system
  throw new Error(`Platform ${platform} does not have export flows defined for subdir ${subdir}`);
}

/**
 * Map a platform-specific file path back to universal subdir and relative path
 * Uses EXPORT flows (package → workspace direction)
 * This is used during install/apply operations.
 * 
 * Supports local platform configs via cwd.
 */
export function mapPlatformFileToUniversal(
  absPath: string,
  cwd = process.cwd()
): { platform: Platform; subdir: string; relPath: string } | null {
  const normalizedPath = normalizePathForProcessing(absPath);

  // Check each platform using export flows (package → workspace)
  for (const platform of getAllPlatforms({ includeDisabled: true }, cwd)) {
    const definition = getPlatformDefinition(platform, cwd);

    if (definition.export && definition.export.length > 0) {
      for (const flow of definition.export) {
        const toPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0];
        if (!toPattern) continue;
        
        // Extract directory from 'to' pattern (e.g., ".cursor/rules/{name}.mdc" -> ".cursor/rules")
        const parts = toPattern.split('/');
        const platformSubdirPath = parts.slice(0, -1).join('/');
        
        // Check if the path contains this platform subdir
        const subdirIndex = findSubpathIndex(normalizedPath, platformSubdirPath);
        if (subdirIndex !== -1) {
          // Skip switch expressions
          if (typeof flow.from === 'object' && '$switch' in flow.from) {
            continue;
          }
          // Extract universal subdir from 'from' pattern
          // For array patterns, use the first pattern
          const fromPatternRaw = Array.isArray(flow.from) ? flow.from[0] : flow.from;
          const fromPattern = extractPatternString(fromPatternRaw);
          const fromParts = fromPattern.split('/');
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
          const fromExtMatch = fromPattern.match(/\.[^./]+$/);
          
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
 * Map a workspace file path to universal package path using IMPORT flows
 * Uses IMPORT flows (workspace → package direction)
 * This is used during add/save operations.
 * 
 * @param workspaceFilePath - Absolute or workspace-relative path to a workspace file
 * @param cwd - Workspace root directory
 * @returns Mapping result with platform, universal subdir, and relative path, or null if no match
 */
export function mapWorkspaceFileToUniversal(
  workspaceFilePath: string,
  cwd = process.cwd()
): { platform: Platform; subdir: string; relPath: string; flow: Flow } | null {
  // Resolve symlinks to get real paths for consistent comparison
  const absolutePath = realpathSync(workspaceFilePath);
  const absoluteCwd = realpathSync(cwd);
  
  // Convert to workspace-relative path for matching against flow patterns
  const relativePath = relative(absoluteCwd, absolutePath).replace(/\\/g, '/');

  // Check each platform using import flows (workspace → package)
  for (const platform of getAllPlatforms({ includeDisabled: true }, cwd)) {
    const definition = getPlatformDefinition(platform, cwd);

    if (definition.import && definition.import.length > 0) {
      for (const flow of definition.import) {
        // Skip switch expressions
        if (typeof flow.from === 'object' && '$switch' in flow.from) {
          continue;
        }
        const fromPatternRaw = Array.isArray(flow.from) ? flow.from[0] : flow.from;
        if (!fromPatternRaw) continue;
        const fromPattern = extractPatternString(fromPatternRaw);
        
        // Check if this file matches the full pattern (using relative path)
        if (!matchesFlowPattern(relativePath, fromPattern)) {
          continue;
        }
        
        // Extract universal subdir from 'to' pattern
        const toPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0];
        if (!toPattern) continue;
        
        const toParts = toPattern.split('/');
        const subdir = toParts[0];
        
        // Extract the relative path by mapping from fromPattern to toPattern
        const relPath = mapPathUsingFlowPattern(relativePath, fromPattern, toPattern);
        
        if (relPath) {
          return { platform, subdir, relPath, flow };
        }
      }
    }
  }

  return null;
}

/**
 * Check if a path matches a flow pattern (supports globs)
 */
function matchesFlowPattern(normalizedPath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '___DOUBLESTAR_SLASH___')
    .replace(/\/\*\*/g, '___SLASH_DOUBLESTAR___')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]+')
    .replace(/___DOUBLESTAR_SLASH___/g, '(?:.*?/)?')
    .replace(/___SLASH_DOUBLESTAR___/g, '(?:/.*)?')
    .replace(/___DOUBLESTAR___/g, '.*');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

/**
 * Map a path from one pattern to another (workspace → package)
 * Handles glob patterns and extension transformations
 */
function mapPathUsingFlowPattern(
  sourcePath: string,
  fromPattern: string,
  toPattern: string
): string | null {
  // Handle ** recursive patterns
  if (fromPattern.includes('**') && toPattern.includes('**')) {
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
      if (!sourcePath.startsWith(fromBase + '/') && !sourcePath.startsWith('/' + fromBase + '/')) {
        return null;
      }
      const startPos = sourcePath.indexOf(fromBase);
      relativeSubpath = sourcePath.slice(startPos + fromBase.length + 1);
    }
    
    // Handle extension mapping if suffixes specify extensions
    if (fromSuffix && toSuffix) {
      const fromExt = fromSuffix.replace(/^\/?\*+/, '');
      const toExt = toSuffix.replace(/^\/?\*+/, '');
      if (fromExt && toExt && fromExt !== toExt) {
        relativeSubpath = relativeSubpath.replace(new RegExp(fromExt.replace('.', '\\.') + '$'), toExt);
      }
    }
    
    // Build target path (package-relative, no base)
    return relativeSubpath;
  }
  
  // Handle single-level * patterns
  if (fromPattern.includes('*') && toPattern.includes('*')) {
    const sourceFileName = basename(sourcePath);
    const sourceExt = extname(sourcePath);
    const sourceBase = basename(sourcePath, sourceExt);
    
    const toParts = toPattern.split('*');
    const toPrefix = toParts[0];
    const toSuffix = toParts[1] || '';
    
    const targetExt = toSuffix.startsWith('.') ? toSuffix : (sourceExt + toSuffix);
    const targetFileName = sourceBase + targetExt;
    
    // Get directory structure from toPrefix (remove leading platform dir)
    const toPrefixParts = toPrefix.split('/').filter(p => p);
    // First part is the subdir, rest is the directory structure
    const targetRelPath = toPrefixParts.slice(1).concat([targetFileName]).join('/');
    
    return targetRelPath;
  }
  
  // No globs - exact mapping
  // Extract just the filename and map it
  const fileName = basename(sourcePath);
  const toFileName = basename(toPattern);
  
  // Check if extensions differ
  const sourceExt = extname(fileName);
  const targetExt = extname(toFileName);
  
  let mappedFileName = fileName;
  if (sourceExt !== targetExt && targetExt) {
    mappedFileName = basename(fileName, sourceExt) + targetExt;
  }
  
  // Get directory from toPattern
  const toDir = dirname(toPattern);
  const toDirParts = toDir.split('/').filter(p => p && p !== '.');
  // First part is the subdir, rest is directory structure
  const relDir = toDirParts.slice(1).join('/');
  
  return relDir ? `${relDir}/${mappedFileName}` : mappedFileName;
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
  const flows = definition.export || [];
  
  // Construct the full source path for matching
  const sourcePath = `${subdir}/${relPath}`;
  
  const candidateFlows = flows.filter((flow: Flow) => {
    // Skip switch expressions
    if (typeof flow.from === 'object' && '$switch' in flow.from) {
      return false;
    }
    const fromPatternRaw = Array.isArray(flow.from) ? flow.from[0] : flow.from;
    const fromPattern = extractPatternString(fromPatternRaw);
    return fromPattern.startsWith(`${subdir}/`);
  });
  if (candidateFlows.length === 0) {
    throw new Error(`Platform ${definition.id} does not support subdir ${subdir}`);
  }

  // Find a flow that matches this source path
  const matchingFlow = candidateFlows.find((flow: Flow) => {
    // Skip switch expressions
    if (typeof flow.from === 'object' && '$switch' in flow.from) {
      return false;
    }
    const fromPatternRaw = Array.isArray(flow.from) ? flow.from[0] : flow.from;
    const fromPattern = extractPatternString(fromPatternRaw);
    
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
          .map((flow: Flow) => {
            // Skip switch expressions
            if (typeof flow.from === 'object' && '$switch' in flow.from) {
              return '';
            }
            const fromPatternRaw = Array.isArray(flow.from) ? flow.from[0] : flow.from;
            const fromPattern = extractPatternString(fromPatternRaw);
            return extname(fromPattern);
          })
          .filter((ext: string) => typeof ext === 'string' && ext.length > 0)
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
  // For array patterns, use the first pattern
  // Skip switch expressions
  if (typeof fromPattern === 'object' && '$switch' in fromPattern) {
    throw new Error('Cannot resolve target path from SwitchExpression - expression must be resolved first');
  }
  const fromPatternStr = Array.isArray(fromPattern) ? fromPattern[0] : fromPattern;
  const targetPath = resolveTargetPathFromGlob(sourcePath, fromPatternStr, targetPathPattern);

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


