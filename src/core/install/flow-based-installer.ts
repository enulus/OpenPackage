/**
 * Flow-Based Installer Module
 * 
 * Handles installation of package files using the declarative flow system.
 * Integrates with the existing install pipeline to execute flow transformations
 * for each package file, with multi-package composition and priority-based merging.
 */

import { join, dirname, basename, relative } from 'path';
import { promises as fs } from 'fs';
import type { Platform } from '../platforms.js';
import type { Flow, FlowContext, FlowResult } from '../../types/flows.js';
import type { InstallOptions } from '../../types/index.js';
import { getPlatformDefinition, getGlobalFlows, platformUsesFlows } from '../platforms.js';
import { createFlowExecutor } from '../flows/flow-executor.js';
import { exists, ensureDir } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { toTildePath } from '../../utils/path-resolution.js';

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
    const sources: string[] = [];
    
    // Resolve source pattern
    const sourcePattern = resolvePattern(flow.from, context);
    const sourcePaths = await matchPattern(sourcePattern, packageRoot);
    
    sources.push(...sourcePaths);
    flowSources.set(flow, sources);
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
  const matches: string[] = [];
  
  // Extract directory path and file pattern
  const patternDir = dirname(pattern);
  const filePattern = basename(pattern);
  
  const searchDir = join(baseDir, patternDir);
  
  // Check if directory exists
  if (!(await exists(searchDir))) {
    return matches;
  }
  
  // Handle simple patterns (no wildcards or placeholders)
  if (!filePattern.includes('*') && !filePattern.includes('{')) {
    // Exact file match
    const exactPath = join(searchDir, filePattern);
    if (await exists(exactPath)) {
      matches.push(relative(baseDir, exactPath));
    }
    return matches;
  }
  
  // Handle patterns with wildcards or placeholders
  const files = await fs.readdir(searchDir);
  
  // Convert pattern to regex
  // Replace {name} with capture group, * with .*
  let regexPattern = filePattern
    .replace(/\{name\}/g, '([^/]+)')
    .replace(/\*/g, '.*');
  
  const regex = new RegExp('^' + regexPattern + '$');
  
  for (const file of files) {
    if (regex.test(file)) {
      const fullPath = join(searchDir, file);
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        matches.push(relative(baseDir, fullPath));
      }
    }
  }
  
  return matches;
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
    errors: []
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
    
    // Execute flows
    for (const [flow, sources] of flowSources) {
      for (const sourcePath of sources) {
        try {
          // Extract captured {name} from source path for use in target path
          const capturedName = extractCapturedName(sourcePath, flow.from);
          
          // Update context with current source
          const sourceContext: FlowContext = {
            ...flowContext,
            variables: {
              ...flowContext.variables,
              sourcePath,
              sourceDir: dirname(sourcePath),
              sourceFile: basename(sourcePath),
              // Override name with captured value if it exists
              ...(capturedName ? { capturedName } : {})
            }
          };
          
          // Execute flow
          const flowResult = await executor.executeFlow(flow, sourceContext);
          
          // Check if flow was skipped due to condition
          const wasSkipped = flowResult.warnings?.includes('Flow skipped due to condition');
          
          // Only count as processed if the flow wasn't skipped
          if (!wasSkipped) {
            result.filesProcessed++;
          }
          
          if (flowResult.success && !wasSkipped) {
            // Count as written if not dry run
            if (!dryRun) {
              result.filesWritten++;
            }
            
            // Collect conflicts
            if (flowResult.conflicts && flowResult.conflicts.length > 0) {
              for (const conflict of flowResult.conflicts) {
                // Build packages array with priority info
                const packages: Array<{ packageName: string; priority: number; chosen: boolean }> = [];
                
                // Add winner
                packages.push({
                  packageName: conflict.winner,
                  priority: 0, // We don't have priority info in FlowConflict
                  chosen: true
                });
                
                // Add losers
                for (const loser of conflict.losers) {
                  packages.push({
                    packageName: loser,
                    priority: 0,
                    chosen: false
                  });
                }
                
                result.conflicts.push({
                  targetPath: conflict.path,
                  packages,
                  message: `Conflict in ${conflict.path}: ${conflict.winner} overwrites ${conflict.losers.join(', ')}`
                });
              }
            }
          } else if (!flowResult.success) {
            // Flow failed with an error
            result.success = false;
            result.errors.push({
              flow,
              sourcePath,
              error: flowResult.error || new Error('Unknown error'),
              message: `Failed to execute flow for ${sourcePath}: ${flowResult.error?.message || 'Unknown error'}`
            });
          }
          // Note: Skipped flows (wasSkipped=true) are not errors, just log at debug level
        } catch (error) {
          result.success = false;
          result.errors.push({
            flow,
            sourcePath,
            error: error as Error,
            message: `Error processing ${sourcePath}: ${(error as Error).message}`
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
    errors: []
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
