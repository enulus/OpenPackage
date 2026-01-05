/**
 * Flow-Based Installer Module
 * 
 * Handles installation of package files using the declarative flow system.
 * Integrates with the existing install pipeline to execute flow transformations
 * for each package file, with multi-package composition and priority-based merging.
 */

import { join, dirname, basename, relative, extname } from 'path';
import { promises as fs } from 'fs';
import type { Platform } from '../platforms.js';
import type { Flow, FlowContext, FlowResult } from '../../types/flows.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import type { InstallOptions } from '../../types/index.js';
import { getPlatformDefinition, getGlobalFlows, platformUsesFlows } from '../platforms.js';
import { createFlowExecutor } from '../flows/flow-executor.js';
import { exists, ensureDir } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { toTildePath } from '../../utils/path-resolution.js';
import { minimatch } from 'minimatch';

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
// Flow Discovery
// ============================================================================

/**
 * Get applicable flows for a platform, including global flows
 */
function getApplicableFlows(platform: Platform, cwd: string): Flow[] {
  const flows: Flow[] = [];
  
  // Add global flows first (applied before platform-specific)
  const globalFlows = getGlobalFlows(cwd);
  if (globalFlows && globalFlows.length > 0) {
    flows.push(...globalFlows);
  }
  
  // Add platform-specific flows
  const definition = getPlatformDefinition(platform, cwd);
  if (definition.flows && definition.flows.length > 0) {
    flows.push(...definition.flows);
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
    const sourcePattern = resolvePattern(flow.from, context);
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
 */
async function matchPattern(pattern: string, baseDir: string): Promise<string[]> {
  // Fast path: no wildcards/placeholders, just check exact file
  if (!pattern.includes('*') && !pattern.includes('{')) {
    const exactPath = join(baseDir, pattern);
    if (await exists(exactPath)) {
      return [relative(baseDir, exactPath)];
    }
    return [];
  }

  // Globs: reuse a minimatch-based recursive walk similar to flow-executor.ts
  const parts = pattern.split('/');
  const globPart = parts.findIndex(p => p.includes('*'));

  const matches: string[] = [];

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
 * Execute flows for a single package installation
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

    // Execute flows per *concrete source file* (avoid re-expanding globs inside executor)
    for (const [flow, sources] of flowSources) {
      for (const sourceRel of sources) {
        const sourceAbs = join(packageRoot, sourceRel);
        try {
          const capturedName = extractCapturedName(sourceRel, flow.from);

          const sourceContext: FlowContext = {
            ...flowContext,
            variables: {
              ...flowContext.variables,
              sourcePath: sourceRel,
              sourceDir: dirname(sourceRel),
              sourceFile: basename(sourceRel),
              ...(capturedName ? { capturedName } : {})
            }
          };

          // Resolve a concrete target path so flow-executor doesn't need glob expansion.
          const rawToPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0] ?? '';
          const resolvedToPattern = resolvePattern(rawToPattern, sourceContext, capturedName);
          const targetAbs = resolveTargetFromGlob(sourceAbs, flow.from, resolvedToPattern, sourceContext);
          const targetRel = relative(workspaceRoot, targetAbs);

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
                Array.isArray(flowResult.keys) &&
                flowResult.keys.length > 0;

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
