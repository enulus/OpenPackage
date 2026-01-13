/**
 * Flow-Based Installer Module
 * 
 * Handles installation of package files using the declarative flow system.
 * Integrates with the existing install pipeline to execute flow transformations
 * for each package file, with multi-package composition and priority-based merging.
 */

import { join, dirname, basename, relative, extname } from 'path';
import { promises as fs } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import type { Platform } from '../platforms.js';
import type { Flow, FlowContext, FlowResult } from '../../types/flows.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type { InstallOptions, Package } from '../../types/index.js';
import { getPlatformDefinition, getGlobalExportFlows, platformUsesFlows, getAllPlatforms, isPlatformId } from '../platforms.js';
import { createFlowExecutor } from '../flows/flow-executor.js';
import { exists, ensureDir, readTextFile, writeTextFile, ensureDir as ensureDirUtil } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { toTildePath } from '../../utils/path-resolution.js';
import { minimatch } from 'minimatch';
import { parseUniversalPath } from '../../utils/platform-file.js';
import type { PackageFormat } from '../install/format-detector.js';
import {
  detectPackageFormat,
  shouldInstallDirectly,
  shouldUsePathMappingOnly,
  needsConversion
} from '../install/format-detector.js';
import { createPlatformConverter } from '../flows/platform-converter.js';
import { isJunk } from 'junk';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the first pattern from a flow's from field
 * For array patterns, returns the first pattern; for string, returns as-is
 */
function getFirstFromPattern(from: string | string[]): string {
  return Array.isArray(from) ? from[0] : from;
}

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface FlowInstallContext {
  packageName: string;
  packageRoot: string;
  workspaceRoot: string;
  platform: Platform;
  packageVersion: string;
  priority: number;
  dryRun: boolean;
  /**
   * Optional package format metadata (e.g., from plugin transformer)
   * If provided, skips format detection
   */
  packageFormat?: any;  // Using any to avoid circular dependency with format-detector
}

export interface FlowInstallResult {
  success: boolean;
  filesProcessed: number;
  filesWritten: number;
  conflicts: FlowConflictReport[];
  errors: FlowInstallError[];
  /**
   * Workspace-absolute target files written (or that would be written in dryRun)
   * Used for workspace index updates.
   */
  targetPaths: string[];
  /**
   * Package-relative source file -> workspace-relative target files
   * Used for precise uninstall and index tracking.
   */
  fileMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>;
}

export interface FlowConflictReport {
  targetPath: string;
  packages: Array<{
    packageName: string;
    priority: number;
    chosen: boolean;
  }>;
  message: string;
}

export interface FlowInstallError {
  flow: Flow;
  sourcePath: string;
  error: Error;
  message: string;
}

// ============================================================================
// Platform Suffix Detection Helpers
// ============================================================================

/**
 * Extract platform suffix from filename (e.g., "mcp.claude.jsonc" -> "claude")
 * Works for both root-level files and files in subdirectories
 */
function extractPlatformSuffixFromFilename(filename: string): string | null {
  const knownPlatforms = getAllPlatforms({ includeDisabled: true }) as readonly Platform[];
  const baseName = basename(filename);
  const parts = baseName.split('.');
  
  // Need at least 3 parts: name.platform.ext
  if (parts.length >= 3) {
    const possiblePlatform = parts[parts.length - 2];
    if (isPlatformId(possiblePlatform)) {
      return possiblePlatform;
    }
  }
  
  return null;
}

/**
 * Strip platform suffix from filename (e.g., "mcp.claude.jsonc" -> "mcp.jsonc")
 */
function stripPlatformSuffixFromFilename(filename: string): string {
  const platformSuffix = extractPlatformSuffixFromFilename(filename);
  if (!platformSuffix) {
    return filename;
  }
  
  const dir = dirname(filename);
  const baseName = basename(filename);
  const parts = baseName.split('.');
  
  // Remove platform suffix (second-to-last part)
  const strippedParts = [...parts.slice(0, -2), parts[parts.length - 1]];
  const strippedBaseName = strippedParts.join('.');
  
  return dir === '.' ? strippedBaseName : join(dir, strippedBaseName);
}

// ============================================================================
// Flow Discovery
// ============================================================================

/**
 * Get applicable flows for a platform, including global flows
 */
function getApplicableFlows(platform: Platform, cwd: string): Flow[] {
  const flows: Flow[] = [];
  
  // Add global export flows first (applied before platform-specific)
  const globalExportFlows = getGlobalExportFlows(cwd);
  if (globalExportFlows && globalExportFlows.length > 0) {
    flows.push(...globalExportFlows);
  }
  
  // Add platform-specific export flows
  const definition = getPlatformDefinition(platform, cwd);
  if (definition.export && definition.export.length > 0) {
    flows.push(...definition.export);
  }
  
  return flows;
}

/**
 * Discover source files that match flow patterns
 * Resolves {name} placeholders and glob patterns
 */
async function discoverFlowSources(
  flows: Flow[],
  packageRoot: string,
  context: FlowContext
): Promise<Map<Flow, string[]>> {
  const flowSources = new Map<Flow, string[]>();
  for (const flow of flows) {
    const firstPattern = getFirstFromPattern(flow.from);
    const sourcePattern = resolvePattern(firstPattern, context);
    const sourcePaths = await matchPattern(sourcePattern, packageRoot);
    flowSources.set(flow, sourcePaths);
  }
  return flowSources;
}

/**
 * Resolve pattern placeholders like {name}
 * Note: {name} is reserved for pattern matching and is NOT replaced
 * unless explicitly provided in the context variables
 */
function resolvePattern(pattern: string, context: FlowContext, capturedName?: string): string {
  return pattern.replace(/{(\w+)}/g, (match, key) => {
    // If capturedName is provided and this is {name}, use the captured value
    if (key === 'name' && capturedName !== undefined) {
      return capturedName;
    }
    
    // Otherwise, reserve {name} for pattern matching - don't substitute it
    if (key === 'name') {
      return match;
    }
    
    if (key in context.variables) {
      return String(context.variables[key]);
    }
    return match;
  });
}

/**
 * Extract the captured {name} value from a source path that matched a pattern
 * For example: sourcePath="rules/typescript.md", pattern="rules/{name}.md" → "typescript"
 */
function extractCapturedName(sourcePath: string, pattern: string): string | undefined {
  // Convert pattern to regex with capture group for {name}
  const regexPattern = pattern
    .replace(/\{name\}/g, '([^/]+)')
    .replace(/\*/g, '.*')
    .replace(/\./g, '\\.');
  
  const regex = new RegExp('^' + regexPattern + '$');
  const match = sourcePath.match(regex);
  
  if (match && match[1]) {
    return match[1];
  }
  
  return undefined;
}

/**
 * Match files against a pattern
 * Supports simple patterns with {name} placeholders and * wildcards
 * Also discovers platform-specific variant files (e.g., mcp.claude.jsonc for mcp.jsonc)
 */
async function matchPattern(pattern: string, baseDir: string): Promise<string[]> {
  const matches: string[] = [];
  
  // Fast path: no wildcards/placeholders, check exact file and platform-specific variants
  if (!pattern.includes('*') && !pattern.includes('{')) {
    const exactPath = join(baseDir, pattern);
    
    // Check for exact match
    if (await exists(exactPath)) {
      matches.push(relative(baseDir, exactPath));
    }
    
    // Also check for platform-specific variants (e.g., mcp.claude.jsonc, mcp.cursor.jsonc)
    const dirPath = dirname(exactPath);
    const fileName = basename(exactPath);
    const nameParts = fileName.split('.');
    
    if (nameParts.length >= 2 && await exists(dirPath)) {
      // Get all known platforms
      const knownPlatforms = getAllPlatforms({ includeDisabled: true }) as readonly Platform[];
      
      // For each platform, check if a platform-specific variant exists
      // Pattern: name.platform.ext (e.g., mcp.claude.jsonc)
      const ext = nameParts[nameParts.length - 1];
      const baseName = nameParts.slice(0, -1).join('.');
      
      for (const platform of knownPlatforms) {
        const platformFileName = `${baseName}.${platform}.${ext}`;
        const platformPath = join(dirPath, platformFileName);
        
        if (await exists(platformPath)) {
          matches.push(relative(baseDir, platformPath));
        }
      }
    }
    
    return matches;
  }

  // Globs: reuse a minimatch-based recursive walk similar to flow-executor.ts
  const parts = pattern.split('/');
  const globPart = parts.findIndex(p => p.includes('*'));

  // No glob segment (e.g. {name}.md): scan the parent dir and filter
  if (globPart === -1) {
    const dirRel = dirname(pattern);
    const filePattern = basename(pattern);
    const searchDir = join(baseDir, dirRel);
    if (!(await exists(searchDir))) return [];
    const entries = await fs.readdir(searchDir, { withFileTypes: true });
    const regex = new RegExp(
      '^' +
        filePattern
          .replace(/\{name\}/g, '([^/]+)')
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*') +
        '$'
    );
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!regex.test(entry.name)) continue;
      matches.push(relative(baseDir, join(searchDir, entry.name)));
    }
    return matches;
  }

  const dirPath = join(baseDir, ...parts.slice(0, globPart));
  const filePattern = parts.slice(globPart).join('/');
  if (!(await exists(dirPath))) {
    return [];
  }

  await findMatchingFiles(dirPath, filePattern, baseDir, matches);
  return matches;
}

async function findMatchingFiles(
  dir: string,
  pattern: string,
  baseDir: string,
  matches: string[]
): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(baseDir, fullPath);
      if (entry.isDirectory()) {
        await findMatchingFiles(fullPath, pattern, baseDir, matches);
      } else if (entry.isFile()) {
        if (minimatch(rel, pattern, { dot: false })) {
          matches.push(rel);
        }
      }
    }
  } catch {
    // ignore
  }
}

function resolveTargetFromGlob(
  sourceAbsPath: string,
  fromPattern: string,
  toPattern: string,
  context: FlowContext
): string {
  const sourceRelFromPackage = relative(context.packageRoot, sourceAbsPath);

  // If 'to' pattern has glob, map the structure
  if (toPattern.includes('*')) {
    // Handle ** recursive patterns
    if (fromPattern.includes('**') && toPattern.includes('**')) {
      const fromParts = fromPattern.split('**');
      const toParts = toPattern.split('**');
      const fromBase = fromParts[0].replace(/\/$/, '');
      const toBase = toParts[0].replace(/\/$/, '');

      const fromSuffix = fromParts[1] || '';
      const toSuffix = toParts[1] || '';

      let relativeSubpath = sourceRelFromPackage;
      if (fromBase) {
        relativeSubpath = sourceRelFromPackage.startsWith(fromBase + '/')
          ? sourceRelFromPackage.slice(fromBase.length + 1)
          : sourceRelFromPackage;
      }

      // Handle extension mapping if suffixes specify extensions: /**/*.md -> /**/*.mdc
      if (fromSuffix && toSuffix) {
        const fromExt = fromSuffix.replace(/^\/?\*+/, '');
        const toExt = toSuffix.replace(/^\/?\*+/, '');
        if (fromExt && toExt && fromExt !== toExt) {
          relativeSubpath = relativeSubpath.replace(
            new RegExp(fromExt.replace('.', '\\.') + '$'),
            toExt
          );
        }
      }

      const targetPath = toBase ? join(toBase, relativeSubpath) : relativeSubpath;
      return join(context.workspaceRoot, targetPath);
    }

    // Single-level * patterns
    const sourceExt = extname(sourceAbsPath);
    const sourceBase = basename(sourceAbsPath, sourceExt);

    const toParts = toPattern.split('*');
    const toPrefix = toParts[0];
    const toSuffix = toParts[1] || '';

    const targetExt = toSuffix.startsWith('.') ? toSuffix : (sourceExt + toSuffix);
    const targetFileName = sourceBase + targetExt;
    return join(context.workspaceRoot, toPrefix + targetFileName);
  }

  // No glob in target - use as-is
  return join(context.workspaceRoot, toPattern);
}

// ============================================================================
// Flow Execution
// ============================================================================

/**
 * Execute flows for a single package installation with format detection and conversion
 */
export async function installPackageWithFlows(
  installContext: FlowInstallContext,
  options?: InstallOptions
): Promise<FlowInstallResult> {
  const {
    packageName,
    packageRoot,
    workspaceRoot,
    platform,
    packageVersion,
    priority,
    dryRun
  } = installContext;
  
  const result: FlowInstallResult = {
    success: true,
    filesProcessed: 0,
    filesWritten: 0,
    conflicts: [],
    errors: [],
    targetPaths: [],
    fileMapping: {}
  };
  
  try {
    // Check if platform uses flows
    if (!platformUsesFlows(platform, workspaceRoot)) {
      // Fall back to subdirs-based installation
      logger.debug(`Platform ${platform} does not use flows, skipping flow-based installation`);
      return result;
    }
    
    // Phase 1: Get or detect package format
    const packageFormat = installContext.packageFormat || await detectPackageFormatFromDirectory(packageRoot);
    
    logger.info('Package format determination', {
      providedFormat: installContext.packageFormat ? 'yes' : 'no',
      providedType: installContext.packageFormat?.type,
      providedPlatform: installContext.packageFormat?.platform,
      finalType: packageFormat.type,
      finalPlatform: packageFormat.platform
    });
    
    logger.debug('Package format', {
      package: packageName,
      type: packageFormat.type,
      platform: packageFormat.platform,
      confidence: packageFormat.confidence,
      isNativeFormat: packageFormat.isNativeFormat,
      nativePlatform: packageFormat.nativePlatform,
      targetPlatform: platform,
      source: installContext.packageFormat ? 'provided' : 'detected'
    });
    
    // Phase 2: Check if path-mapping-only installation (native format)
    if (shouldUsePathMappingOnly(packageFormat, platform)) {
      logger.info(`Installing ${packageName} for ${platform} with path mapping only (native format, no content transforms)`);
      return await installWithPathMappingOnly(installContext, packageFormat, options);
    }
    
    // Phase 3: Check if direct installation (no conversion, no path mapping)
    if (shouldInstallDirectly(packageFormat, platform)) {
      logger.info(`Installing ${packageName} AS-IS for ${platform} platform (matching format)`);
      return await installDirectly(installContext, packageFormat);
    }
    
    // Phase 5: Check if conversion needed
    if (needsConversion(packageFormat, platform)) {
      logger.info(`Converting ${packageName} from ${packageFormat.platform} to ${platform} format`);
      return await installWithConversion(installContext, packageFormat, options);
    }
    
    // Phase 7: Standard flow-based installation (universal format)
    // This is the original behavior for universal packages
    logger.debug(`Standard flow-based installation for ${packageName}`);
    
    // Get applicable flows
    const flows = getApplicableFlows(platform, workspaceRoot);
    if (flows.length === 0) {
      logger.debug(`No flows defined for platform ${platform}`);
      return result;
    }
    
    // Create flow executor
    const executor = createFlowExecutor();
    
    // Get platform definition for accessing rootFile and other metadata
    const platformDef = getPlatformDefinition(platform, workspaceRoot);
    
    // Build flow context
    const flowContext: FlowContext = {
      workspaceRoot,
      packageRoot,
      platform,
      packageName,
      direction: 'install',
      variables: {
        name: packageName,
        version: packageVersion,
        priority,
        rootFile: platformDef.rootFile,
        rootDir: platformDef.rootDir
      },
      dryRun
    };
    
    // Discover source files for each flow
    const flowSources = await discoverFlowSources(flows, packageRoot, flowContext);

    // Build a map of base paths to platforms that have override files
    // This allows universal files to exclude platforms that have platform-specific overrides
    const overridesByBasePath = new Map<string, Set<Platform>>();
    for (const [flow, sources] of flowSources) {
      for (const sourceRel of sources) {
        const parsed = parseUniversalPath(sourceRel, { allowPlatformSuffix: true });
        const platformSuffix = parsed?.platformSuffix || extractPlatformSuffixFromFilename(sourceRel);
        
        if (platformSuffix) {
          // For universal subdir files, use the parsed baseKey
          // For root-level files, use the stripped filename as the baseKey
          const baseKey = parsed 
            ? `${parsed.universalSubdir}/${parsed.relPath}`
            : stripPlatformSuffixFromFilename(sourceRel);
          
          if (!overridesByBasePath.has(baseKey)) {
            overridesByBasePath.set(baseKey, new Set());
          }
          overridesByBasePath.get(baseKey)!.add(platformSuffix as Platform);
        }
      }
    }

    // Execute flows per *concrete source file* (avoid re-expanding globs inside executor)
    for (const [flow, sources] of flowSources) {
      for (const sourceRel of sources) {
        const sourceAbs = join(packageRoot, sourceRel);
        
        // Check for platform-specific file suffix (e.g., commands/foo.claude.md or mcp.claude.jsonc)
        // Parse with allowPlatformSuffix to detect and strip platform suffix
        const parsed = parseUniversalPath(sourceRel, { allowPlatformSuffix: true });
        
        // For files without universal subdir prefix, check platform suffix directly from filename
        const platformSuffix = parsed?.platformSuffix || extractPlatformSuffixFromFilename(sourceRel);
        const isUniversalSubdirFile = parsed !== null;
        
        // If file has platform suffix, only process for that specific platform
        if (platformSuffix) {
          const filePlatform = platformSuffix as Platform;
          if (filePlatform !== platform) {
            // This file is for a different platform, skip it
            logger.debug(`Skipping ${sourceRel} for platform ${platform} (file is for ${filePlatform})`);
            continue;
          }
          // File is for current platform - continue processing
        } else if (isUniversalSubdirFile && parsed) {
          // Universal file with subdir: check if there's a platform-specific override for current platform
          const baseKey = `${parsed.universalSubdir}/${parsed.relPath}`;
          const overridePlatforms = overridesByBasePath.get(baseKey);
          if (overridePlatforms && overridePlatforms.has(platform)) {
            // This universal file is overridden by a platform-specific file for this platform
            logger.debug(`Skipping universal file ${sourceRel} for platform ${platform} (overridden by platform-specific file)`);
            continue;
          }
        } else {
          // Root-level file without platform suffix: check if there's a platform-specific override
          const strippedFileName = stripPlatformSuffixFromFilename(sourceRel);
          
          // Check if any file in sources is a platform-specific override for this file
          const hasOverrideForPlatform = sources.some(s => {
            const sSuffix = extractPlatformSuffixFromFilename(s);
            const sStripped = stripPlatformSuffixFromFilename(s);
            return sSuffix === platform && sStripped === strippedFileName;
          });
          
          if (hasOverrideForPlatform) {
            // This universal file is overridden by a platform-specific file for this platform
            logger.debug(`Skipping universal file ${sourceRel} for platform ${platform} (overridden by platform-specific file)`);
            continue;
          }
        }
        
        try {
          // Use suffix-stripped path if available, otherwise use original
          // This is the path used for flow pattern matching and target path resolution
          const sourceRelForMapping = parsed ? `${parsed.universalSubdir}/${parsed.relPath}` : sourceRel;
          const sourceAbsForMapping = parsed ? join(packageRoot, sourceRelForMapping) : sourceAbs;
          
          const firstPattern = getFirstFromPattern(flow.from);
          const capturedName = extractCapturedName(sourceRelForMapping, firstPattern);

          const sourceContext: FlowContext = {
            ...flowContext,
            variables: {
              ...flowContext.variables,
              sourcePath: sourceRelForMapping,
              sourceDir: dirname(sourceRelForMapping),
              sourceFile: basename(sourceRelForMapping),
              ...(capturedName ? { capturedName } : {})
            }
          };

          // Resolve a concrete target path so flow-executor doesn't need glob expansion.
          // Use the suffix-stripped source path for target resolution
          const rawToPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0] ?? '';
          const resolvedToPattern = resolvePattern(rawToPattern, sourceContext, capturedName);
          const targetAbs = resolveTargetFromGlob(sourceAbsForMapping, firstPattern, resolvedToPattern, sourceContext);
          const targetRel = relative(workspaceRoot, targetAbs);

          // Create a concrete flow using the original source path for file reading
          // but with target path computed from the suffix-stripped source
          // The flow executor will resolve flow.from relative to packageRoot
          const concreteFlow: Flow = {
            ...flow,
            from: sourceRel, // Original source path (may have platform suffix) for file reading
            to: targetRel     // Target path computed from stripped source
          };

          const flowResult = await executor.executeFlow(concreteFlow, sourceContext);
          const wasSkipped = flowResult.warnings?.includes('Flow skipped due to condition');

          if (!wasSkipped) {
            result.filesProcessed++;
          }

          if (flowResult.success && !wasSkipped) {
            const target = typeof flowResult.target === 'string' ? flowResult.target : (flowResult.target as any);
            if (typeof target === 'string') {
              result.targetPaths.push(target);
              const targetRelFromWorkspace = relative(workspaceRoot, target);
              if (!result.fileMapping[sourceRel]) result.fileMapping[sourceRel] = [];

              const normalizedTargetRel = targetRelFromWorkspace.replace(/\\/g, '/');
              const isKeyTrackedMerge =
                (flowResult.merge === 'deep' || flowResult.merge === 'shallow') &&
                Array.isArray(flowResult.keys);

              if (isKeyTrackedMerge) {
                result.fileMapping[sourceRel].push({
                  target: normalizedTargetRel,
                  merge: flowResult.merge,
                  keys: flowResult.keys
                });
              } else {
                result.fileMapping[sourceRel].push(normalizedTargetRel);
              }

            }

            if (!dryRun) {
              result.filesWritten++;
            }

            if (flowResult.conflicts && flowResult.conflicts.length > 0) {
              for (const conflict of flowResult.conflicts) {
                const packages: Array<{ packageName: string; priority: number; chosen: boolean }> = [];
                packages.push({ packageName: conflict.winner, priority: 0, chosen: true });
                for (const loser of conflict.losers) {
                  packages.push({ packageName: loser, priority: 0, chosen: false });
                }
                result.conflicts.push({
                  targetPath: conflict.path,
                  packages,
                  message: `Conflict in ${conflict.path}: ${conflict.winner} overwrites ${conflict.losers.join(', ')}`
                });
              }
            }
          } else if (!flowResult.success) {
            result.success = false;
            result.errors.push({
              flow,
              sourcePath: sourceRel,
              error: flowResult.error || new Error('Unknown error'),
              message: `Failed to execute flow for ${sourceRel}: ${flowResult.error?.message || 'Unknown error'}`
            });
          }
        } catch (error) {
          result.success = false;
          result.errors.push({
            flow,
            sourcePath: sourceRel,
            error: error as Error,
            message: `Error processing ${sourceRel}: ${(error as Error).message}`
          });
        }
      }
    }
    
    // Log results
    if (result.filesProcessed > 0) {
      logger.info(
        `Processed ${result.filesProcessed} files for ${packageName} on platform ${platform}` +
        (dryRun ? ' (dry run)' : `, wrote ${result.filesWritten} files`)
      );
    }
    
    // Log conflicts
    if (result.conflicts.length > 0) {
      logger.warn(`Detected ${result.conflicts.length} conflicts during installation`);
      for (const conflict of result.conflicts) {
        const winner = conflict.packages.find(p => p.chosen);
        logger.warn(
          `  ${toTildePath(conflict.targetPath)}: ${winner?.packageName} (priority ${winner?.priority}) overwrites ` +
          `${conflict.packages.find(p => !p.chosen)?.packageName}`
        );
      }
    }
    
    // Log errors
    if (result.errors.length > 0) {
      logger.error(`Encountered ${result.errors.length} errors during installation`);
      for (const error of result.errors) {
        logger.error(`  ${error.sourcePath}: ${error.message}`);
      }
    }
    
  } catch (error) {
    result.success = false;
    logger.error(`Failed to install package ${packageName} with flows: ${(error as Error).message}`);
  }
  
  return result;
}

/**
 * Execute flows for multiple packages with priority-based merging
 */
export async function installPackagesWithFlows(
  packages: Array<{
    packageName: string;
    packageRoot: string;
    packageVersion: string;
    priority: number;
  }>,
  workspaceRoot: string,
  platform: Platform,
  options?: InstallOptions
): Promise<FlowInstallResult> {
  const aggregatedResult: FlowInstallResult = {
    success: true,
    filesProcessed: 0,
    filesWritten: 0,
    conflicts: [],
    errors: [],
    targetPaths: [],
    fileMapping: {}
  };
  
  const dryRun = options?.dryRun ?? false;
  
  // Sort packages by priority (LOWER priority first, so higher priority writes last and wins)
  const sortedPackages = [...packages].sort((a, b) => a.priority - b.priority);
  
  // Track files written by each package for conflict detection
  const fileTargets = new Map<string, Array<{ packageName: string; priority: number }>>();
  
  // Install each package
  for (const pkg of sortedPackages) {
    const installContext: FlowInstallContext = {
      packageName: pkg.packageName,
      packageRoot: pkg.packageRoot,
      workspaceRoot,
      platform,
      packageVersion: pkg.packageVersion,
      priority: pkg.priority,
      dryRun
    };
    
    // Get flows and discover target files to track conflicts
    const flows = getApplicableFlows(platform, workspaceRoot);
    const flowContext: FlowContext = {
      workspaceRoot,
      packageRoot: pkg.packageRoot,
      platform,
      packageName: pkg.packageName,
      direction: 'install',
      variables: {
        name: pkg.packageName,
        version: pkg.packageVersion,
        priority: pkg.priority
      },
      dryRun
    };
    
    // Discover target paths for this package
    const flowSources = await discoverFlowSources(flows, pkg.packageRoot, flowContext);
    for (const [flow, sources] of flowSources) {
      if (sources.length > 0) {
        // Determine target path from flow
        const targetPath = typeof flow.to === 'string' 
          ? resolvePattern(flow.to, flowContext)
          : Object.keys(flow.to)[0]; // For multi-target, use first target
        
        // Track this package writing to this target
        if (!fileTargets.has(targetPath)) {
          fileTargets.set(targetPath, []);
        }
        fileTargets.get(targetPath)!.push({
          packageName: pkg.packageName,
          priority: pkg.priority
        });
      }
    }
    
    const result = await installPackageWithFlows(installContext, options);
    
    // Aggregate results
    aggregatedResult.filesProcessed += result.filesProcessed;
    aggregatedResult.filesWritten += result.filesWritten;
    aggregatedResult.errors.push(...result.errors);
    aggregatedResult.targetPaths.push(...(result.targetPaths ?? []));
    for (const [source, targets] of Object.entries(result.fileMapping ?? {})) {
      const existing = aggregatedResult.fileMapping[source] ?? [];
      aggregatedResult.fileMapping[source] = Array.from(new Set([...existing, ...targets])).sort();
    }
    
    if (!result.success) {
      aggregatedResult.success = false;
    }
  }
  
  // Detect conflicts: files written by multiple packages
  for (const [targetPath, writers] of fileTargets) {
    if (writers.length > 1) {
      // Sort by priority to determine winner
      const sortedWriters = [...writers].sort((a, b) => b.priority - a.priority);
      const winner = sortedWriters[0];
      
      aggregatedResult.conflicts.push({
        targetPath,
        packages: sortedWriters.map((w, i) => ({
          packageName: w.packageName,
          priority: w.priority,
          chosen: i === 0 // First in sorted list (highest priority) is chosen
        })),
        message: `Conflict in ${targetPath}: ${winner.packageName} (priority ${winner.priority}) overwrites ${sortedWriters.slice(1).map(w => w.packageName).join(', ')}`
      });
    }
  }
  
  return aggregatedResult;
}

// ============================================================================
// Format Detection and Conversion Helpers
// ============================================================================

/**
 * Detect package format from directory by reading files
 */
async function detectPackageFormatFromDirectory(packageRoot: string): Promise<PackageFormat> {
  const files: Array<{ path: string; content: string }> = [];
  
  // Read all files in package directory
  try {
    for await (const fullPath of walkFiles(packageRoot)) {
      const relativePath = relative(packageRoot, fullPath);
      
      // Skip git metadata and junk files
      if (relativePath.startsWith('.git/') || relativePath === '.git') {
        continue;
      }
      
      const pathParts = relativePath.split('/');
      if (pathParts.some(part => isJunk(part))) {
        continue;
      }
      
      files.push({
        path: relativePath,
        content: ''  // We only need paths for format detection
      });
    }
  } catch (error) {
    logger.error('Failed to read package directory for format detection', { packageRoot, error });
  }
  
  return detectPackageFormat(files);
}

/**
 * Helper to walk files in directory
 */
async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

/**
 * Install package directly without flow transformations (AS-IS installation)
 * Used when source platform = target platform
 */
async function installDirectly(
  installContext: FlowInstallContext,
  packageFormat: PackageFormat
): Promise<FlowInstallResult> {
  const {
    packageName,
    packageRoot,
    workspaceRoot,
    platform,
    dryRun
  } = installContext;
  
  const result: FlowInstallResult = {
    success: true,
    filesProcessed: 0,
    filesWritten: 0,
    conflicts: [],
    errors: [],
    targetPaths: [],
    fileMapping: {}
  };
  
  logger.info(`Installing ${packageName} directly for ${platform} (no transformations)`);
  
  try {
    // Copy files AS-IS from package to workspace
    for await (const sourcePath of walkFiles(packageRoot)) {
      const relativePath = relative(packageRoot, sourcePath);
      
      // Skip metadata files
      if (relativePath.startsWith('.openpackage/') || relativePath === 'openpackage.yml') {
        continue;
      }
      
      const targetPath = join(workspaceRoot, relativePath);
      
      result.filesProcessed++;
      
      if (!dryRun) {
        await ensureDir(dirname(targetPath));
        await fs.copyFile(sourcePath, targetPath);
        result.filesWritten++;
      }
      
      result.targetPaths.push(targetPath);
      
      // Track file mapping for uninstall
      if (!result.fileMapping[relativePath]) {
        result.fileMapping[relativePath] = [];
      }
      result.fileMapping[relativePath].push(relativePath);
    }
    
    logger.info(`Direct installation complete: ${result.filesProcessed} files processed`);
    
  } catch (error) {
    logger.error('Direct installation failed', { packageName, error });
    result.success = false;
    result.errors.push({
      flow: { from: packageRoot, to: workspaceRoot },
      sourcePath: packageRoot,
      error: error as Error,
      message: `Failed to install directly: ${(error as Error).message}`
    });
  }
  
  return result;
}

/**
 * Install package with path mapping only (no content transformations)
 * 
 * Used for native format packages where content is already correct for the target
 * platform (e.g., Claude plugin with Claude-format frontmatter), but file paths
 * need to be mapped from universal subdirs to platform subdirs.
 * 
 * Strategy:
 * 1. Get platform flows for target platform
 * 2. Strip all content transformations (map, pipe operations)
 * 3. Execute flows with path mapping only
 * 
 * Example:
 *   Source: commands/test.md (Claude plugin root)
 *   Target: .claude/commands/test.md (workspace)
 *   Content: Unchanged (already in Claude format)
 */
async function installWithPathMappingOnly(
  installContext: FlowInstallContext,
  packageFormat: PackageFormat,
  options?: InstallOptions
): Promise<FlowInstallResult> {
  const {
    packageName,
    packageRoot,
    workspaceRoot,
    platform,
    packageVersion,
    priority,
    dryRun
  } = installContext;
  
  const result: FlowInstallResult = {
    success: true,
    filesProcessed: 0,
    filesWritten: 0,
    conflicts: [],
    errors: [],
    targetPaths: [],
    fileMapping: {}
  };
  
  logger.info(`Installing ${packageName} with path mapping only for ${platform} (native format)`);
  
  try {
    // Check if platform uses flows
    if (!platformUsesFlows(platform, workspaceRoot)) {
      logger.warn(`Platform ${platform} does not use flows, falling back to direct installation`);
      return await installDirectly(installContext, packageFormat);
    }
    
    // Get platform flows
    let flows = getApplicableFlows(platform, workspaceRoot);
    if (flows.length === 0) {
      logger.warn(`No flows defined for platform ${platform}, falling back to direct installation`);
      return await installDirectly(installContext, packageFormat);
    }
    
    // Strip content transformations, keeping only path mappings
    flows = stripContentTransformations(flows);
    
    logger.debug(`Using ${flows.length} path-mapping-only flows for ${platform}`);
    
    // Create flow executor
    const executor = createFlowExecutor();
    
    // Get platform definition
    const platformDef = getPlatformDefinition(platform, workspaceRoot);
    
    // Build flow context
    const flowContext: FlowContext = {
      workspaceRoot,
      packageRoot,
      platform,
      packageName,
      direction: 'install',
      variables: {
        name: packageName,
        version: packageVersion,
        priority,
        rootFile: platformDef.rootFile,
        rootDir: platformDef.rootDir
      },
      dryRun
    };
    
    // Discover source files for each flow
    const flowSources = await discoverFlowSources(flows, packageRoot, flowContext);
    
    // Build override map for platform-specific files
    const overridesByBasePath = new Map<string, Set<Platform>>();
    for (const [flow, sources] of flowSources) {
      for (const sourceRel of sources) {
        const parsed = parseUniversalPath(sourceRel, { allowPlatformSuffix: true });
        const platformSuffix = parsed?.platformSuffix || extractPlatformSuffixFromFilename(sourceRel);
        
        if (platformSuffix) {
          const baseKey = parsed 
            ? `${parsed.universalSubdir}/${parsed.relPath}`
            : stripPlatformSuffixFromFilename(sourceRel);
          
          if (!overridesByBasePath.has(baseKey)) {
            overridesByBasePath.set(baseKey, new Set());
          }
          overridesByBasePath.get(baseKey)!.add(platformSuffix as Platform);
        }
      }
    }
    
    // Execute flows per source file
    for (const [flow, sources] of flowSources) {
      for (const sourceRel of sources) {
        const sourceAbs = join(packageRoot, sourceRel);
        
        // Check for platform-specific file suffix
        const parsed = parseUniversalPath(sourceRel, { allowPlatformSuffix: true });
        const platformSuffix = parsed?.platformSuffix || extractPlatformSuffixFromFilename(sourceRel);
        const isUniversalSubdirFile = parsed !== null;
        
        // Skip files not meant for this platform
        if (platformSuffix) {
          const filePlatform = platformSuffix as Platform;
          if (filePlatform !== platform) {
            logger.debug(`Skipping ${sourceRel} for platform ${platform} (file is for ${filePlatform})`);
            continue;
          }
        } else if (isUniversalSubdirFile && parsed) {
          const baseKey = `${parsed.universalSubdir}/${parsed.relPath}`;
          const overridePlatforms = overridesByBasePath.get(baseKey);
          if (overridePlatforms && overridePlatforms.has(platform)) {
            logger.debug(`Skipping universal file ${sourceRel} for platform ${platform} (overridden by platform-specific file)`);
            continue;
          }
        } else {
          const strippedFileName = stripPlatformSuffixFromFilename(sourceRel);
          const hasOverrideForPlatform = sources.some(s => {
            const sSuffix = extractPlatformSuffixFromFilename(s);
            const sStripped = stripPlatformSuffixFromFilename(s);
            return sSuffix === platform && sStripped === strippedFileName;
          });
          
          if (hasOverrideForPlatform) {
            logger.debug(`Skipping universal file ${sourceRel} for platform ${platform} (overridden by platform-specific file)`);
            continue;
          }
        }
        
        try {
          // Use suffix-stripped path for flow pattern matching
          const sourceRelForMapping = parsed ? `${parsed.universalSubdir}/${parsed.relPath}` : sourceRel;
          const sourceAbsForMapping = parsed ? join(packageRoot, sourceRelForMapping) : sourceAbs;
          
          const firstPattern = getFirstFromPattern(flow.from);
          const capturedName = extractCapturedName(sourceRelForMapping, firstPattern);
          
          const sourceContext: FlowContext = {
            ...flowContext,
            variables: {
              ...flowContext.variables,
              sourcePath: sourceRelForMapping,
              sourceDir: dirname(sourceRelForMapping),
              sourceFile: basename(sourceRelForMapping),
              ...(capturedName ? { capturedName } : {})
            }
          };
          
          // Resolve target path
          const rawToPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0] ?? '';
          const resolvedToPattern = resolvePattern(rawToPattern, sourceContext, capturedName);
          const targetAbs = resolveTargetFromGlob(sourceAbsForMapping, firstPattern, resolvedToPattern, sourceContext);
          const targetRel = relative(workspaceRoot, targetAbs);
          
          // Create concrete flow
          const concreteFlow: Flow = {
            ...flow,
            from: sourceRel,
            to: targetRel
          };
          
          const flowResult = await executor.executeFlow(concreteFlow, sourceContext);
          const wasSkipped = flowResult.warnings?.includes('Flow skipped due to condition');
          
          if (!wasSkipped) {
            result.filesProcessed++;
          }
          
          if (flowResult.success && !wasSkipped) {
            const target = typeof flowResult.target === 'string' ? flowResult.target : (flowResult.target as any);
            if (typeof target === 'string') {
              result.targetPaths.push(target);
              const targetRelFromWorkspace = relative(workspaceRoot, target);
              if (!result.fileMapping[sourceRel]) result.fileMapping[sourceRel] = [];
              
              const normalizedTargetRel = targetRelFromWorkspace.replace(/\\/g, '/');
              const isKeyTrackedMerge =
                (flowResult.merge === 'deep' || flowResult.merge === 'shallow') &&
                Array.isArray(flowResult.keys);
              
              if (isKeyTrackedMerge) {
                result.fileMapping[sourceRel].push({
                  target: normalizedTargetRel,
                  merge: flowResult.merge,
                  keys: flowResult.keys
                });
              } else {
                result.fileMapping[sourceRel].push(normalizedTargetRel);
              }
            }
            
            if (!dryRun) {
              result.filesWritten++;
            }
            
            if (flowResult.conflicts && flowResult.conflicts.length > 0) {
              for (const conflict of flowResult.conflicts) {
                const packages: Array<{ packageName: string; priority: number; chosen: boolean }> = [];
                packages.push({ packageName: conflict.winner, priority: 0, chosen: true });
                for (const loser of conflict.losers) {
                  packages.push({ packageName: loser, priority: 0, chosen: false });
                }
                result.conflicts.push({
                  targetPath: conflict.path,
                  packages,
                  message: `Conflict in ${conflict.path}: ${conflict.winner} overwrites ${conflict.losers.join(', ')}`
                });
              }
            }
          } else if (!flowResult.success) {
            result.success = false;
            result.errors.push({
              flow,
              sourcePath: sourceRel,
              error: flowResult.error || new Error('Unknown error'),
              message: `Failed to execute flow for ${sourceRel}: ${flowResult.error?.message || 'Unknown error'}`
            });
          }
        } catch (error) {
          result.success = false;
          result.errors.push({
            flow,
            sourcePath: sourceRel,
            error: error as Error,
            message: `Error processing ${sourceRel}: ${(error as Error).message}`
          });
        }
      }
    }
    
    // Log results
    if (result.filesProcessed > 0) {
      logger.info(
        `Processed ${result.filesProcessed} files for ${packageName} on platform ${platform}` +
        (dryRun ? ' (dry run)' : `, wrote ${result.filesWritten} files`)
      );
    }
    
    // Log conflicts
    if (result.conflicts.length > 0) {
      logger.warn(`Detected ${result.conflicts.length} conflicts during installation`);
      for (const conflict of result.conflicts) {
        const winner = conflict.packages.find(p => p.chosen);
        logger.warn(
          `  ${toTildePath(conflict.targetPath)}: ${winner?.packageName} (priority ${winner?.priority}) overwrites ` +
          `${conflict.packages.find(p => !p.chosen)?.packageName}`
        );
      }
    }
    
    // Log errors
    if (result.errors.length > 0) {
      logger.error(`Encountered ${result.errors.length} errors during installation`);
      for (const error of result.errors) {
        logger.error(`  ${error.sourcePath}: ${error.message}`);
      }
    }
    
  } catch (error) {
    result.success = false;
    logger.error(`Failed to install package ${packageName} with path mapping: ${(error as Error).message}`);
    result.errors.push({
      flow: { from: packageRoot, to: workspaceRoot },
      sourcePath: packageRoot,
      error: error as Error,
      message: `Failed to install with path mapping: ${(error as Error).message}`
    });
  }
  
  return result;
}

/**
 * Strip content transformations from flows, keeping only path mappings
 * 
 * Removes:
 * - map operations (frontmatter transformations)
 * - pipe operations (except format converters needed for file type changes)
 * 
 * Keeps:
 * - from/to path patterns (the core path mapping)
 * - merge strategies (for multi-package composition)
 * - when conditions (for conditional flows)
 */
function stripContentTransformations(flows: Flow[]): Flow[] {
  return flows.map(flow => {
    const strippedFlow: Flow = {
      from: flow.from,
      to: flow.to
    };
    
    // Keep merge strategy if defined
    if (flow.merge) {
      strippedFlow.merge = flow.merge;
    }
    
    // Keep when conditions
    if (flow.when) {
      strippedFlow.when = flow.when;
    }
    
    // Note: pipe transforms are now handled within the map pipeline via $pipe operation
    
    // Explicitly skip map transformations (commented for clarity)
    // strippedFlow.map = undefined;
    
    return strippedFlow;
  });
}

/**
 * Install package with format conversion
 * Converts from source platform format → universal → target platform format
 */
async function installWithConversion(
  installContext: FlowInstallContext,
  packageFormat: PackageFormat,
  options?: InstallOptions
): Promise<FlowInstallResult> {
  const {
    packageName,
    packageRoot,
    workspaceRoot,
    platform,
    dryRun
  } = installContext;
  
  const result: FlowInstallResult = {
    success: true,
    filesProcessed: 0,
    filesWritten: 0,
    conflicts: [],
    errors: [],
    targetPaths: [],
    fileMapping: {}
  };
  
  try {
    // Step 1: Load package files
    const packageFiles: Array<{ path: string; content: string }> = [];
    
    for await (const sourcePath of walkFiles(packageRoot)) {
      const relativePath = relative(packageRoot, sourcePath);
      
      // Skip metadata
      if (relativePath.startsWith('.openpackage/') || relativePath === 'openpackage.yml') {
        continue;
      }
      
      const content = await readTextFile(sourcePath);
      packageFiles.push({ path: relativePath, content, encoding: 'utf8' } as any);
    }
    
    // Step 2: Create package object
    const pkg: Package = {
      metadata: {
        name: packageName,
        version: installContext.packageVersion
      },
      files: packageFiles,
      _format: packageFormat
    };
    
    // Step 3: Convert from source platform format to universal format
    const converter = createPlatformConverter(workspaceRoot);
    const conversionResult = await converter.convert(pkg, platform, { dryRun });
    
    if (!conversionResult.success || !conversionResult.convertedPackage) {
      logger.error('Package conversion failed', { 
        package: packageName,
        stages: conversionResult.stages 
      });
      
      result.success = false;
      result.errors.push({
        flow: { from: packageRoot, to: workspaceRoot },
        sourcePath: packageRoot,
        error: new Error('Conversion failed'),
        message: 'Failed to convert package format'
      });
      
      return result;
    }
    
    logger.info(`Conversion to universal format complete (${conversionResult.stages.length} stages), now applying ${platform} platform flows`);
    
    // Step 4: Write converted (universal format) files to temporary directory
    
    let tempPackageRoot: string | null = null;
    
    try {
      tempPackageRoot = await mkdtemp(join(tmpdir(), 'opkg-converted-'));
      
      // Write all converted files to temp directory
      for (const file of conversionResult.convertedPackage.files) {
        const filePath = join(tempPackageRoot, file.path);
        await ensureDirUtil(dirname(filePath));
        await writeTextFile(filePath, file.content);
      }
      
      logger.debug(`Wrote ${conversionResult.convertedPackage.files.length} converted files to temp directory`, { 
        tempPackageRoot 
      });
      
      // Step 5: Install from temp directory using standard flow-based installation
      // This will apply the target platform flows to the now-universal-format content
      const convertedInstallContext: FlowInstallContext = {
        ...installContext,
        packageRoot: tempPackageRoot,
        // Important: Clear packageFormat so it gets re-detected as universal format
        packageFormat: undefined
      };
      
      // Recursively call installPackageWithFlows, but with converted package root
      // This will apply standard platform flows (Universal → Target Platform)
      const installResult = await installPackageWithFlows(convertedInstallContext, options);
      
      // Cleanup temp directory
      if (tempPackageRoot) {
        await rm(tempPackageRoot, { recursive: true, force: true });
      }
      
      return installResult;
      
    } catch (error) {
      // Cleanup on error
      if (tempPackageRoot) {
        try {
          await rm(tempPackageRoot, { recursive: true, force: true });
        } catch (cleanupError) {
          logger.warn('Failed to cleanup temp directory after error', { tempPackageRoot, cleanupError });
        }
      }
      
      logger.error('Failed to install converted package', { packageName, error });
      result.success = false;
      result.errors.push({
        flow: { from: packageRoot, to: workspaceRoot },
        sourcePath: packageRoot,
        error: error as Error,
        message: `Failed to install converted package: ${(error as Error).message}`
      });
      
      return result;
    }
    
  } catch (error) {
    logger.error('Conversion installation failed', { packageName, error });
    result.success = false;
    result.errors.push({
      flow: { from: packageRoot, to: workspaceRoot },
      sourcePath: packageRoot,
      error: error as Error,
      message: `Failed to install with conversion: ${(error as Error).message}`
    });
    
    return result;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a file should be processed with flows
 */
export function shouldUseFlows(platform: Platform, cwd: string): boolean {
  return platformUsesFlows(platform, cwd);
}

/**
 * Get flow statistics for reporting
 */
export function getFlowStatistics(result: FlowInstallResult): {
  total: number;
  written: number;
  conflicts: number;
  errors: number;
} {
  return {
    total: result.filesProcessed,
    written: result.filesWritten,
    conflicts: result.conflicts.length,
    errors: result.errors.length
  };
}
