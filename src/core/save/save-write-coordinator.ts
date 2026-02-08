/**
 * Write Coordinator
 * 
 * This module coordinates file write operations for resolved save content.
 * It handles both universal content and platform-specific variants,
 * ensuring idempotent writes with optimization for unchanged files.
 * 
 * Key responsibilities:
 * - Build write operations from resolution results
 * - Execute writes to filesystem
 * - Handle directory creation
 * - Track success/failure for each write
 * - Optimize by skipping writes when content is identical
 * 
 * @module save-write-coordinator
 */

import { dirname, join } from 'path';
import { ensureDir, exists, readTextFile, writeTextFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { createPlatformSpecificRegistryPath } from '../../utils/platform-specific-paths.js';
import { extractPackageContribution } from './save-merge-extractor.js';
import { allocateTempSubdir } from './save-conversion-helper.js';
import { getPlatformDefinition, getGlobalImportFlows, type Platform } from '../platforms.js';
import { createFlowExecutor } from '../flows/flow-executor.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { minimatch } from 'minimatch';
import type { SaveCandidate, ResolutionResult, WriteOperation, WriteResult } from './save-types.js';
import type { Flow, FlowContext } from '../../types/flows.js';

/**
 * Write resolution results to package source
 * 
 * This is the main entry point for file writes. It handles both:
 * - Universal content (if selected)
 * - Platform-specific content (for each platform candidate)
 * 
 * Each write is tracked individually with success/failure status.
 * Individual write failures don't halt the pipeline.
 * 
 * @param packageRoot - Absolute path to package source
 * @param registryPath - Registry path being written
 * @param resolution - Resolution result from conflict resolution
 * @param localCandidate - Optional local (source) candidate for comparison
 * @param workspaceRoot - Optional workspace root for import transformations
 * @returns Array of write results (one per write operation)
 */
export async function writeResolution(
  packageRoot: string,
  registryPath: string,
  resolution: ResolutionResult,
  localCandidate?: SaveCandidate,
  workspaceRoot?: string
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  
  // Write universal content (if selected)
  if (resolution.selection) {
    const universalResult = await writeUniversal(
      packageRoot,
      registryPath,
      resolution.selection,
      localCandidate,
      workspaceRoot
    );
    results.push(universalResult);
  } else {
    // No universal selected - log this (user chose only platform-specific)
    logger.debug(`No universal content selected for ${registryPath} - keeping original untouched`);
  }
  
  // Write platform-specific content
  for (const platformCandidate of resolution.platformSpecific) {
    const platformResult = await writePlatformSpecific(
      packageRoot,
      registryPath,
      platformCandidate,
      workspaceRoot
    );
    results.push(platformResult);
  }
  
  return results;
}

/**
 * Write universal content to package source
 * 
 * Writes the selected workspace candidate to the universal (non-platform-specific)
 * path in the package source. For merged files, extracts only the package's
 * contribution before writing. Optimizes by skipping write if content is identical
 * to existing source.
 * 
 * @param packageRoot - Package source absolute path
 * @param registryPath - Registry path to write
 * @param candidate - Selected universal candidate
 * @param localCandidate - Optional local candidate for comparison
 * @param workspaceRoot - Optional workspace root for import transformations
 * @returns Write result with success/failure status
 */
async function writeUniversal(
  packageRoot: string,
  registryPath: string,
  candidate: SaveCandidate,
  localCandidate?: SaveCandidate,
  workspaceRoot?: string
): Promise<WriteResult> {
  const targetPath = join(packageRoot, registryPath);
  
  // Prepare content for writing (extract if merged)
  const preparedContent = await prepareContentForWrite(candidate, registryPath, workspaceRoot);
  
  // Determine if write is needed (optimization)
  const writeDecision = shouldWrite(candidate, localCandidate, preparedContent.content);
  
  const operation: WriteOperation = {
    registryPath,
    targetPath,
    content: preparedContent.content,
    operation: writeDecision.operation,
    isPlatformSpecific: false
  };
  
  // Skip if no write needed
  if (!writeDecision.needed) {
    logger.debug(`Skipping write for ${registryPath}: content identical to source`);
    return {
      operation,
      success: true
    };
  }
  
  // Perform write
  const writeResult = await safeWrite(targetPath, preparedContent.content);
  
  if (writeResult.success) {
    const action = operation.operation === 'create' ? 'Created' : 'Updated';
    logger.debug(`${action} ${registryPath}${preparedContent.wasExtracted ? ' (extracted package contribution)' : ''}`);
  }
  
  return {
    operation,
    success: writeResult.success,
    error: writeResult.error
  };
}

/**
 * Write platform-specific content to package source
 * 
 * Writes a platform-specific variant to its platform-specific path
 * (e.g., tools/search.cursor.md, CLAUDE.md). For merged files, extracts
 * only the package's contribution before writing.
 * 
 * @param packageRoot - Package source absolute path
 * @param registryPath - Universal registry path
 * @param candidate - Platform-specific candidate
 * @param workspaceRoot - Optional workspace root for import transformations
 * @returns Write result with success/failure status
 */
async function writePlatformSpecific(
  packageRoot: string,
  registryPath: string,
  candidate: SaveCandidate,
  workspaceRoot?: string
): Promise<WriteResult> {
  const platform = candidate.platform;
  
  // Validate platform
  if (!platform || platform === 'ai') {
    return {
      operation: {
        registryPath,
        targetPath: '',
        content: '',
        operation: 'skip',
        isPlatformSpecific: true
      },
      success: false,
      error: new Error('Candidate has no platform association')
    };
  }
  
  // Build platform-specific registry path
  const platformRegistryPath = createPlatformSpecificRegistryPath(registryPath, platform);
  if (!platformRegistryPath) {
    return {
      operation: {
        registryPath,
        targetPath: '',
        content: '',
        operation: 'skip',
        isPlatformSpecific: true,
        platform
      },
      success: false,
      error: new Error(`Could not create platform-specific path for ${platform}`)
    };
  }
  
  const targetPath = join(packageRoot, platformRegistryPath);
  
  // Prepare content for writing (extract if merged)
  const preparedContent = await prepareContentForWrite(candidate, platformRegistryPath, workspaceRoot);
  
  // Determine operation type
  const fileExists = await exists(targetPath);
  const operationType: 'create' | 'update' = fileExists ? 'update' : 'create';
  
  const operation: WriteOperation = {
    registryPath: platformRegistryPath,
    targetPath,
    content: preparedContent.content,
    operation: operationType,
    isPlatformSpecific: true,
    platform
  };
  
  // Check if content matches existing (optimization)
  if (fileExists) {
    try {
      const existingContent = await readTextFile(targetPath);
      if (existingContent === preparedContent.content) {
        logger.debug(`Skipping write for ${platformRegistryPath}: content identical`);
        operation.operation = 'skip';
        return {
          operation,
          success: true
        };
      }
    } catch (error) {
      // Ignore read errors - will attempt write anyway
      logger.debug(`Could not read existing file ${platformRegistryPath}: ${error}`);
    }
  }
  
  // Perform write
  const writeResult = await safeWrite(targetPath, preparedContent.content);
  
  if (writeResult.success) {
    const action = operationType === 'create' ? 'Created' : 'Updated';
    logger.debug(
      `${action} platform-specific file: ${platformRegistryPath}${preparedContent.wasExtracted ? ' (extracted package contribution)' : ''}`
    );
  }
  
  return {
    operation,
    success: writeResult.success,
    error: writeResult.error
  };
}

/**
 * Apply import flow transformation to convert workspace format to universal format
 * 
 * For platform-specific workspaces (e.g., OpenCode with `mcp` → `mcpServers`),
 * we need to apply the import flow transformations to convert the extracted
 * content back to universal format.
 * 
 * @param content - Extracted content in workspace format
 * @param platform - Source platform
 * @param registryPath - Target registry path (universal)
 * @param workspacePath - Source workspace path
 * @param workspaceRoot - Workspace root directory
 * @returns Transformation result with transformed content
 */
async function applyImportTransformation(
  content: string,
  platform: Platform,
  registryPath: string,
  workspacePath: string,
  workspaceRoot: string
): Promise<{ success: boolean; transformedContent?: string; reason?: string }> {
  try {
    // Get platform definition and import flows
    const platformDef = getPlatformDefinition(platform, workspaceRoot);
    const platformImportFlows = platformDef.import || [];
    const globalImportFlows = getGlobalImportFlows(workspaceRoot) || [];
    const allImportFlows = [...globalImportFlows, ...platformImportFlows];
    
    if (allImportFlows.length === 0) {
      return {
        success: false,
        reason: 'No import flows defined for platform'
      };
    }
    
    // Find matching import flow for this registry path
    const matchingFlow = findMatchingFlow(
      allImportFlows,
      workspacePath,
      registryPath,
      platform,
      workspaceRoot
    );
    
    if (!matchingFlow) {
      return {
        success: false,
        reason: 'No matching import flow found'
      };
    }
    
    // Check if flow has map operations
    if (!matchingFlow.map || matchingFlow.map.length === 0) {
      return {
        success: false,
        reason: 'Flow has no map operations'
      };
    }
    
    // Create temporary directory for transformation
    const tempDir = await allocateTempSubdir();
    const inputDir = join(tempDir, 'in');
    const outputDir = join(tempDir, 'out');
    await ensureDir(inputDir);
    await ensureDir(outputDir);
    
    // Write extracted content to temp input file
    const inputFileName = registryPath.split('/').pop() || 'file.json';
    const inputFilePath = join(inputDir, inputFileName);
    await writeTextFile(inputFilePath, content);
    
    // Build flow context for transformation
    const flowContext: FlowContext = {
      workspaceRoot: outputDir,
      packageRoot: inputDir,
      platform: platform,
      packageName: 'temp',
      direction: 'install',  // Import flows run during install
      variables: {
        name: 'temp',
        version: '0.0.0',
        platform: platform,
        source: platform,
        sourcePlatform: platform,
        targetPlatform: 'openpackage'
      },
      dryRun: false
    };
    
    // Execute the flow
    const executor = createFlowExecutor();
    const concreteFlow: Flow = {
      ...matchingFlow,
      from: inputFileName
    };
    
    const flowResult = await executor.executeFlow(concreteFlow, flowContext);
    
    if (!flowResult.success) {
      return {
        success: false,
        reason: `Flow execution failed: ${flowResult.error?.message}`
      };
    }
    
    // Read transformed content
    if (typeof flowResult.target !== 'string') {
      return {
        success: false,
        reason: 'Flow did not produce target path'
      };
    }
    
    const outputFilePath = flowResult.target;
    if (!(await exists(outputFilePath))) {
      return {
        success: false,
        reason: 'Flow did not produce output file'
      };
    }
    
    const transformedContent = await readTextFile(outputFilePath);
    
    logger.debug(
      `Successfully transformed extracted content from ${platform} format to universal`,
      { registryPath }
    );
    
    return {
      success: true,
      transformedContent
    };
    
  } catch (error) {
    logger.debug(
      `Import transformation failed for ${registryPath} (platform: ${platform})`,
      { error }
    );
    return {
      success: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Find matching import flow for workspace → universal transformation
 * 
 * @param flows - Array of import flows
 * @param workspacePath - Workspace file path (from pattern)
 * @param registryPath - Universal registry path (to pattern)
 * @param platform - Platform context
 * @param workspaceRoot - Workspace root
 * @returns Matching flow or undefined
 */
function findMatchingFlow(
  flows: Flow[],
  workspacePath: string,
  registryPath: string,
  platform: Platform,
  workspaceRoot: string
): Flow | undefined {
  const registryPathCandidates = getRegistryPathCandidates(registryPath);
  for (const flow of flows) {
    // Check if 'from' pattern matches workspace path
    const fromPatterns = Array.isArray(flow.from) ? flow.from : [flow.from];
    
    let matchesFrom = false;
    for (const fromPattern of fromPatterns) {
      // Handle switch expressions - evaluate to get default value
      if (typeof fromPattern === 'object' && '$switch' in fromPattern) {
        // For save operations, we're in workspace context, so use default value
        const defaultValue = fromPattern.$switch?.default;
        if (typeof defaultValue === 'string') {
          if (minimatch(workspacePath, defaultValue, { dot: true })) {
            matchesFrom = true;
            break;
          }
        }
        continue;
      }
      
      if (typeof fromPattern !== 'string') {
        continue;
      }
      
      // Check if workspace path matches the 'from' pattern
      if (minimatch(workspacePath, fromPattern, { dot: true })) {
        matchesFrom = true;
        break;
      }
    }
    
    if (!matchesFrom) {
      continue;
    }
    
    // Check if 'to' pattern matches registry path
    const toPattern = Array.isArray(flow.to) ? flow.to[0] : flow.to;
    
    // Handle switch expressions
    if (typeof toPattern === 'object' && '$switch' in toPattern) {
      logger.debug('Skipping flow with switch expression in to field');
      continue;
    }
    
    if (typeof toPattern !== 'string') {
      continue;
    }
    
    // Check if registry path matches the 'to' pattern (including extension variants)
    const matchesTo = registryPathCandidates.some(candidatePath =>
      minimatch(candidatePath, toPattern, { dot: true })
    );
    if (!matchesTo) {
      continue;
    }
    
    // Check conditional 'when' clause if present
    if (flow.when) {
      const conditionMet = evaluateWhenCondition(flow.when, platform);
      if (!conditionMet) {
        logger.debug(`Flow condition not met for ${registryPath}`, { when: flow.when });
        continue;
      }
    }
    
    // Found matching flow
    logger.debug(
      `Matched import flow: from=${workspacePath} to=${registryPath}`,
      { platform }
    );
    return flow;
  }
  
  logger.debug(
    `No matching import flow found`,
    { workspacePath, registryPath, platform, flowCount: flows.length }
  );
  return undefined;
}

/**
 * Expand registry path to include common extension variants.
 * 
 * This helps match flows when the universal file is stored as JSON vs JSONC.
 * Example: "mcp.json" should match flows targeting "mcp.jsonc" and vice versa.
 */
function getRegistryPathCandidates(registryPath: string): string[] {
  const candidates = [registryPath];
  if (registryPath.endsWith('.jsonc')) {
    candidates.push(registryPath.replace(/\.jsonc$/, '.json'));
  } else if (registryPath.endsWith('.json')) {
    candidates.push(registryPath.replace(/\.json$/, '.jsonc'));
  }
  return candidates;
}

/**
 * Evaluate 'when' conditional clause
 * 
 * Simplified evaluation for common patterns used in platforms.jsonc.
 * 
 * @param when - Conditional expression
 * @param platform - Current platform
 * @returns True if condition is met
 */
function evaluateWhenCondition(when: any, platform: Platform): boolean {
  // Handle { "$eq": ["$$platform", "claude"] }
  if (when.$eq && Array.isArray(when.$eq) && when.$eq.length === 2) {
    const left = resolveVariable(when.$eq[0], platform);
    const right = resolveVariable(when.$eq[1], platform);
    return left === right;
  }
  
  // Handle { "$ne": ["$$platform", "claude"] }
  if (when.$ne && Array.isArray(when.$ne) && when.$ne.length === 2) {
    const left = resolveVariable(when.$ne[0], platform);
    const right = resolveVariable(when.$ne[1], platform);
    return left !== right;
  }
  
  // Handle { "exists": "file.md" }
  if (when.exists) {
    // For save, assume file exists if we got to this point
    return true;
  }
  
  // Unknown condition type - assume not met (conservative)
  logger.debug('Unknown condition type in when clause', { when });
  return false;
}

/**
 * Resolve variable references like $$platform, $$source
 */
function resolveVariable(value: any, platform: Platform): any {
  if (typeof value === 'string') {
    if (value === '$$platform' || value === '$$source') {
      return platform;
    }
  }
  return value;
}

/**
 * Prepare content for writing by extracting package contribution from merged files
 * 
 * This function detects merged candidates and extracts only the package's
 * contribution before writing. For non-merged files, returns content as-is.
 * 
 * For merged files from platform-specific workspaces (e.g., OpenCode), this function:
 * 1. Extracts the package's keys from the merged workspace file
 * 2. Applies import flow transformations to convert back to universal format
 * 
 * @param candidate - Workspace candidate to prepare
 * @param registryPath - Registry path for logging
 * @param workspaceRoot - Workspace root for conversion
 * @returns Prepared content with extraction metadata
 */
async function prepareContentForWrite(
  candidate: SaveCandidate,
  registryPath: string,
  workspaceRoot?: string
): Promise<{ content: string; wasExtracted: boolean }> {
  // Check if this is a merged file with merge metadata
  const isMergedFile = Boolean(
    candidate.source === 'workspace' &&
    candidate.mergeStrategy &&
    candidate.mergeKeys &&
    candidate.mergeKeys.length > 0
  );
  
  if (!isMergedFile) {
    // Not a merged file - use content as-is
    return { content: candidate.content, wasExtracted: false };
  }
  
  // Attempt to extract package contribution
  logger.debug(
    `Extracting package contribution from merged file: ${registryPath}`,
    {
      strategy: candidate.mergeStrategy,
      keyCount: candidate.mergeKeys!.length,
      platform: candidate.platform
    }
  );
  
  const extractResult = await extractPackageContribution(candidate);
  
  if (extractResult.success && extractResult.extractedContent) {
    logger.info(
      `Successfully extracted package contribution for ${registryPath} ` +
      `(${candidate.mergeKeys!.length} key(s))`
    );
    
    // Apply import flow transformations if candidate has platform info
    let finalContent = extractResult.extractedContent;
    if (candidate.platform && candidate.platform !== 'ai' && workspaceRoot) {
      logger.info(
        `Attempting import transformation for merged file`,
        {
          platform: candidate.platform,
          registryPath,
          displayPath: candidate.displayPath,
          hasWorkspaceRoot: !!workspaceRoot
        }
      );
      
      const transformResult = await applyImportTransformation(
        extractResult.extractedContent,
        candidate.platform,
        registryPath,
        candidate.displayPath,
        workspaceRoot
      );
      
      if (transformResult.success && transformResult.transformedContent) {
        logger.info(
          `Successfully applied import transformation for platform ${candidate.platform}`,
          { registryPath }
        );
        finalContent = transformResult.transformedContent;
      } else {
        logger.warn(
          `Import transformation failed or not applicable: ${transformResult.reason}`,
          { registryPath, platform: candidate.platform }
        );
      }
    } else {
      logger.debug(
        `Skipping import transformation`,
        {
          hasPlatform: !!candidate.platform,
          platform: candidate.platform,
          hasWorkspaceRoot: !!workspaceRoot
        }
      );
    }
    
    return {
      content: finalContent,
      wasExtracted: true
    };
  }
  
  // Extraction failed - fall back to full content with warning
  logger.warn(
    `Failed to extract package contribution from merged file: ${registryPath}`,
    {
      reason: extractResult.error,
      fallback: 'Using full content'
    }
  );
  
  logger.warn(
    `⚠️  Writing full merged content to ${registryPath} - ` +
    `this may include keys from other packages or base workspace content`
  );
  
  return { content: candidate.content, wasExtracted: false };
}

/**
 * Determine if write is needed (optimization)
 * 
 * Compares prepared content with local (source) content via hash.
 * Returns whether write is needed and what operation type.
 * 
 * @param candidate - Workspace candidate (for hash comparison fallback)
 * @param localCandidate - Optional local (source) candidate
 * @param preparedContent - Prepared content to write (may be extracted)
 * @returns Write decision with needed flag and operation type
 */
function shouldWrite(
  candidate: SaveCandidate,
  localCandidate?: SaveCandidate,
  preparedContent?: string
): { needed: boolean; operation: 'create' | 'update' | 'skip' } {
  // No local candidate means file doesn't exist - create
  if (!localCandidate) {
    return { needed: true, operation: 'create' };
  }
  
  // If we have prepared content that differs from original, we need to compare
  // the prepared content with local content directly
  if (preparedContent && preparedContent !== candidate.content) {
    // Content was transformed (extracted) - compare directly
    if (preparedContent === localCandidate.content) {
      return { needed: false, operation: 'skip' };
    }
    return { needed: true, operation: 'update' };
  }
  
  // Compare content hashes (original comparison logic)
  if (candidate.contentHash === localCandidate.contentHash) {
    // Content identical - skip write
    return { needed: false, operation: 'skip' };
  }
  
  // Content differs - update
  return { needed: true, operation: 'update' };
}

/**
 * Safely write file with error handling
 * 
 * Ensures parent directory exists before writing.
 * Returns success/error result without throwing.
 * 
 * @param targetPath - Absolute filesystem path to write
 * @param content - Content to write
 * @returns Result with success flag and optional error
 */
async function safeWrite(
  targetPath: string,
  content: string
): Promise<{ success: boolean; error?: Error }> {
  try {
    // Ensure parent directory exists
    await ensureDir(dirname(targetPath));
    
    // Write file
    await writeTextFile(targetPath, content);
    
    return { success: true };
  } catch (error) {
    logger.error(`Failed to write file ${targetPath}: ${error}`);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
