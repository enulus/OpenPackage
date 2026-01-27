/**
 * Flow Execution Coordinator
 * 
 * Coordinates flow execution for discovered source files.
 * Handles target path resolution, context building, and result aggregation.
 */

import { join, dirname, basename, relative, extname } from 'path';
import type { Flow, FlowContext, FlowResult, SwitchExpression } from '../../types/flows.js';
import type { FlowExecutor } from '../../types/flows.js';
import type { Platform } from '../platforms.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import { createFlowExecutor } from './flow-executor.js';
import { 
  resolvePattern, 
  extractCapturedName, 
  getFirstFromPattern 
} from './flow-source-discovery.js';
import { resolveRecursiveGlobTargetRelativePath } from '../../utils/glob-target-mapping.js';
import { logger } from '../../utils/logger.js';
import { stripPlatformSuffixFromFilename } from './platform-suffix-handler.js';
import { resolveSwitchExpression } from './switch-resolver.js';

/**
 * Execution result with enhanced metadata
 */
export interface ExecutionResult {
  success: boolean;
  filesProcessed: number;
  filesWritten: number;
  targetPaths: string[];
  fileMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>;
  conflicts: Array<{
    path: string;
    winner: string;
    losers: string[];
  }>;
  errors: Array<{
    flow: Flow;
    sourcePath: string;
    error: Error;
    message: string;
  }>;
}

/**
 * Execution context for coordinating flow execution
 */
export interface CoordinatorContext extends FlowContext {
  /**
   * Flow executor instance to use
   */
  executor?: FlowExecutor;
}

/**
 * Execute flows for discovered source files
 * 
 * @param flowSources - Map of flows to source files
 * @param context - Execution context
 * @returns Execution result with aggregated metrics
 */
export async function executeFlowsForSources(
  flowSources: Map<Flow, string[]>,
  context: CoordinatorContext
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    success: true,
    filesProcessed: 0,
    filesWritten: 0,
    targetPaths: [],
    fileMapping: {},
    conflicts: [],
    errors: []
  };
  
  const executor = context.executor || createFlowExecutor();
  
  for (const [flow, sources] of flowSources) {
    for (const sourceRel of sources) {
      try {
        const sourceResult = await processSourceFile(
          flow,
          sourceRel,
          context,
          executor
        );
        
        // Aggregate results
        if (sourceResult.processed) {
          result.filesProcessed++;
        }
        
        if (sourceResult.written && !context.dryRun) {
          result.filesWritten++;
        }
        
        if (sourceResult.targetPath) {
          result.targetPaths.push(sourceResult.targetPath);
        }
        
        if (sourceResult.fileMapping) {
          const key = sourceResult.mappingKey || sourceRel;
          if (!result.fileMapping[key]) {
            result.fileMapping[key] = [];
          }
          result.fileMapping[key].push(...sourceResult.fileMapping);
        }
        
        if (sourceResult.conflicts) {
          result.conflicts.push(...sourceResult.conflicts);
        }
        
        if (!sourceResult.success) {
          result.success = false;
          if (sourceResult.error) {
            result.errors.push({
              flow,
              sourcePath: sourceRel,
              error: sourceResult.error,
              message: sourceResult.error.message
            });
          }
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
  
  return result;
}

/**
 * Result from processing a single source file
 */
interface SourceProcessingResult {
  success: boolean;
  processed: boolean;
  written: boolean;
  targetPath?: string;
  fileMapping?: (string | WorkspaceIndexFileMapping)[];
  mappingKey?: string;
  conflicts?: Array<{
    path: string;
    winner: string;
    losers: string[];
  }>;
  error?: Error;
}

/**
 * Check if a value is a switch expression
 */
function isSwitchExpression(value: any): value is SwitchExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$switch' in value
  );
}

/**
 * Process a single source file through a flow
 * 
 * @param flow - Flow to execute
 * @param sourceRel - Source file path (relative to package root)
 * @param context - Execution context
 * @param executor - Flow executor instance
 * @returns Processing result
 */
async function processSourceFile(
  flow: Flow,
  sourceRel: string,
  context: CoordinatorContext,
  executor: FlowExecutor
): Promise<SourceProcessingResult> {
  const sourceAbs = join(context.packageRoot, sourceRel);
  
  // Extract captured name from pattern
  const firstPattern = getFirstFromPattern(flow.from);
  const capturedName = extractCapturedName(sourceRel, firstPattern);
  
  // Build source-specific context
  const sourceContext: FlowContext = {
    ...context,
    variables: {
      ...context.variables,
      sourcePath: sourceRel,
      sourceDir: dirname(sourceRel),
      sourceFile: basename(sourceRel),
      ...(capturedName ? { capturedName } : {})
    }
  };
  
  // Resolve target path - handle switch expressions
  let rawToPattern: string;
  if (typeof flow.to === 'string') {
    rawToPattern = flow.to;
  } else if (isSwitchExpression(flow.to)) {
    // Resolve switch expression to concrete target path
    rawToPattern = resolveSwitchExpression(flow.to, sourceContext);
  } else {
    // Multi-target flows - use first target
    rawToPattern = Object.keys(flow.to)[0] ?? '';
  }
  const resolvedToPattern = resolvePattern(rawToPattern, sourceContext, capturedName);
  const targetAbs = resolveTargetFromGlob(
    sourceAbs,
    firstPattern,
    resolvedToPattern,
    sourceContext
  );
  const targetRel = relative(context.workspaceRoot, targetAbs);
  
  // Create concrete flow with resolved paths
  const concreteFlow: Flow = {
    ...flow,
    from: sourceRel,
    to: targetRel
  };
  
  // Execute flow
  const flowResult = await executor.executeFlow(concreteFlow, sourceContext);
  
  // Check if flow was skipped
  const wasSkipped = flowResult.warnings?.includes('Flow skipped due to condition');
  
  if (wasSkipped) {
    return {
      success: true,
      processed: false,
      written: false
    };
  }
  
  if (!flowResult.success) {
    return {
      success: false,
      processed: true,
      written: false,
      error: flowResult.error || new Error('Flow execution failed')
    };
  }
  
  // Process successful result
  const target = typeof flowResult.target === 'string' 
    ? flowResult.target 
    : (flowResult.target as any);
  
  if (typeof target !== 'string') {
    return {
      success: true,
      processed: true,
      written: false
    };
  }
  
  const targetRelFromWorkspace = relative(context.workspaceRoot, target);
  const normalizedTargetRel = targetRelFromWorkspace.replace(/\\/g, '/');
  
  // Build file mapping
  const isKeyTrackedMerge =
    (flowResult.merge === 'deep' || flowResult.merge === 'shallow') &&
    Array.isArray(flowResult.keys);
  
  const fileMapping: (string | WorkspaceIndexFileMapping)[] = [];
  
  if (isKeyTrackedMerge) {
    fileMapping.push({
      target: normalizedTargetRel,
      merge: flowResult.merge,
      keys: flowResult.keys
    });
  } else {
    fileMapping.push(normalizedTargetRel);
  }
  
  // Extract conflicts
  const conflicts = flowResult.conflicts?.map(conflict => ({
    path: conflict.path,
    winner: conflict.winner,
    losers: conflict.losers
  })) || [];
  
  return {
    success: true,
    processed: true,
    written: true,
    targetPath: target,
    fileMapping,
    mappingKey: sourceRel,
    conflicts
  };
}

/**
 * Resolve target path from glob patterns
 * Strips platform suffixes from filenames (e.g. read-specs.claude.md -> read-specs.md)
 * 
 * @param sourceAbsPath - Absolute source path
 * @param fromPattern - Source pattern from flow
 * @param toPattern - Target pattern from flow
 * @param context - Flow context
 * @returns Resolved absolute target path
 */
export function resolveTargetFromGlob(
  sourceAbsPath: string,
  fromPattern: string,
  toPattern: string,
  context: FlowContext
): string {
  const sourceRelFromPackage = relative(context.packageRoot, sourceAbsPath);
  
  // If 'to' pattern has glob, map the structure
  if (toPattern.includes('*')) {
    // Handle ** recursive patterns
    if (toPattern.includes('**')) {
      const targetRel = resolveRecursiveGlobTargetRelativePath(
        sourceRelFromPackage,
        fromPattern,
        toPattern
      );
      return join(context.workspaceRoot, targetRel);
    }
    
    // Single-level * patterns
    const sourceExt = extname(sourceAbsPath);
    const sourceBase = basename(sourceAbsPath, sourceExt);
    
    const toParts = toPattern.split('*');
    const toPrefix = toParts[0];
    const toSuffix = toParts[1] || '';
    
    const targetExt = toSuffix.startsWith('.') ? toSuffix : (sourceExt + toSuffix);
    const targetFileName = sourceBase + targetExt;
    
    // Strip platform suffix from the final target filename
    const strippedTargetFileName = stripPlatformSuffixFromFilename(targetFileName);
    
    return join(context.workspaceRoot, toPrefix + strippedTargetFileName);
  }
  
  // No glob in target - use as-is
  return join(context.workspaceRoot, toPattern);
}

/**
 * Build flow context with standard variables
 * 
 * @param baseContext - Base context properties
 * @param platformDef - Platform definition (for rootFile, rootDir)
 * @returns Complete flow context
 */
export function buildFlowContext(
  baseContext: {
    workspaceRoot: string;
    packageRoot: string;
    platform: Platform;
    packageName: string;
    packageVersion: string;
    priority: number;
    dryRun: boolean;
    direction: 'install' | 'save';
  },
  platformDef: {
    rootFile?: string;
    rootDir?: string;
  }
): FlowContext {
  return {
    workspaceRoot: baseContext.workspaceRoot,
    packageRoot: baseContext.packageRoot,
    platform: baseContext.platform,
    packageName: baseContext.packageName,
    direction: baseContext.direction,
    variables: {
      name: baseContext.packageName,
      version: baseContext.packageVersion,
      priority: baseContext.priority,
      rootFile: platformDef.rootFile,
      rootDir: platformDef.rootDir
    },
    dryRun: baseContext.dryRun
  };
}

/**
 * Aggregate results from multiple executions
 * 
 * @param results - Array of execution results
 * @returns Combined result
 */
export function aggregateExecutionResults(results: ExecutionResult[]): ExecutionResult {
  const aggregated: ExecutionResult = {
    success: true,
    filesProcessed: 0,
    filesWritten: 0,
    targetPaths: [],
    fileMapping: {},
    conflicts: [],
    errors: []
  };
  
  for (const result of results) {
    aggregated.filesProcessed += result.filesProcessed;
    aggregated.filesWritten += result.filesWritten;
    aggregated.targetPaths.push(...result.targetPaths);
    aggregated.conflicts.push(...result.conflicts);
    aggregated.errors.push(...result.errors);
    
    // Merge file mappings
    for (const [source, targets] of Object.entries(result.fileMapping)) {
      if (!aggregated.fileMapping[source]) {
        aggregated.fileMapping[source] = [];
      }
      aggregated.fileMapping[source].push(...targets);
    }
    
    if (!result.success) {
      aggregated.success = false;
    }
  }
  
  return aggregated;
}
