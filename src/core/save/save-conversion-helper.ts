/**
 * Save Conversion Helper Module
 * 
 * Provides conversion utilities for transforming workspace platform-specific files
 * to universal format before comparison. This enables semantic equality checks that
 * account for format differences defined in platforms.jsonc.
 * 
 * Key responsibilities:
 * - Apply platform import flows to convert workspace → universal
 * - Calculate hashes of converted content for comparison
 * - Cache conversion results to avoid duplicate work
 * - Handle conversion failures gracefully with fallback
 * 
 * @module save-conversion-helper
 */

import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { getPlatformDefinition, getGlobalImportFlows, getGlobalExportFlows } from '../platforms.js';
import { createFlowExecutor } from '../flows/flow-executor.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { ensureDir, writeTextFile, readTextFile, exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { minimatch } from 'minimatch';
import { extractPackageContribution } from './save-merge-extractor.js';
import type { SaveCandidate } from './save-types.js';
import type { Platform } from '../platforms.js';
import type { Flow, FlowContext } from '../../types/flows.js';

let sharedTempDir: string | null = null;
let tempDirCounter = 0;

export async function initSharedTempDir(): Promise<void> {
  if (!sharedTempDir) {
    sharedTempDir = await mkdtemp(join(tmpdir(), 'opkg-save-'));
  }
}

export async function cleanupSharedTempDir(): Promise<void> {
  if (sharedTempDir) {
    try {
      await rm(sharedTempDir, { recursive: true, force: true });
    } catch (error) {
      logger.debug('Failed to cleanup shared temp directory', { tempDir: sharedTempDir, error });
    }
    sharedTempDir = null;
    tempDirCounter = 0;
  }
}

export async function allocateTempSubdir(): Promise<string> {
  if (!sharedTempDir) {
    const standalone = await mkdtemp(join(tmpdir(), 'opkg-save-standalone-'));
    return standalone;
  }
  const subDir = join(sharedTempDir, `op-${tempDirCounter++}`);
  await ensureDir(subDir);
  return subDir;
}

/**
 * Conversion result with success status
 */
export interface ConversionResult {
  success: boolean;
  convertedContent?: string;
  convertedHash?: string;
  error?: string;
}

/**
 * Cache for converted content hashes
 * Key: `${fullPath}:${contentHash}:${platform}`
 * Value: Converted content hash
 */
const conversionCache = new Map<string, string>();

/**
 * Generate cache key for a candidate
 */
function getCacheKey(candidate: SaveCandidate): string {
  return `${candidate.fullPath}:${candidate.contentHash}:${candidate.platform || 'none'}`;
}

/**
 * Calculate hash of workspace candidate after conversion to universal format
 * 
 * This is the main entry point for conversion-aware hash calculation.
 * It applies platform import flows to convert workspace content to universal format,
 * then calculates the hash for comparison.
 * 
 * @param candidate - Workspace candidate to convert
 * @param workspaceRoot - Absolute path to workspace root
 * @returns Hash of converted content (or original hash if conversion not applicable/fails)
 */
export async function calculateConvertedHash(
  candidate: SaveCandidate,
  workspaceRoot: string
): Promise<string> {
  // Check if candidate has platform - if not, no conversion needed
  if (!candidate.platform || candidate.platform === 'ai') {
    return candidate.contentHash;
  }
  
  // Check cache first
  const cacheKey = getCacheKey(candidate);
  const cached = conversionCache.get(cacheKey);
  if (cached) {
    logger.debug(`Cache hit for converted hash: ${candidate.displayPath}`);
    return cached;
  }
  
  // Perform conversion
  const result = await convertWorkspaceToUniversal(
    candidate.content,
    candidate.platform as Platform,
    candidate.registryPath,
    workspaceRoot
  );
  
  if (!result.success || !result.convertedHash) {
    // Conversion failed or not applicable - fall back to original hash
    logger.debug(
      `Conversion not applicable or failed for ${candidate.displayPath}, using raw hash`,
      { reason: result.error }
    );
    return candidate.contentHash;
  }
  
  // Cache the result
  conversionCache.set(cacheKey, result.convertedHash);
  
  return result.convertedHash;
}

/**
 * Convert workspace platform-specific content to universal format
 * 
 * Applies platform import flows to transform workspace content.
 * Import flows represent workspace → package transformations.
 * 
 * @param workspaceContent - Content from workspace file
 * @param platform - Platform the content is from (e.g., 'cursor', 'claude')
 * @param registryPath - Universal registry path (e.g., 'mcp.jsonc', 'agents/test.md')
 * @param workspaceRoot - Absolute path to workspace root
 * @returns Conversion result with converted content and hash
 */
export async function convertWorkspaceToUniversal(
  workspaceContent: string,
  platform: Platform,
  registryPath: string,
  workspaceRoot: string
): Promise<ConversionResult> {
  try {
    // Get platform definition and import flows
    const platformDef = getPlatformDefinition(platform, workspaceRoot);
    const platformImportFlows = platformDef.import || [];
    const globalImportFlows = getGlobalImportFlows(workspaceRoot) || [];
    const allImportFlows = [...globalImportFlows, ...platformImportFlows];
    
    if (allImportFlows.length === 0) {
      logger.debug(`No import flows defined for platform ${platform}`);
      return {
        success: false,
        error: 'No import flows defined for platform'
      };
    }
    
    // Find matching flow for this registry path
    const matchingFlow = findMatchingImportFlow(
      allImportFlows,
      registryPath,
      platform,
      workspaceRoot
    );
    
    if (!matchingFlow) {
      logger.debug(`No matching import flow for ${registryPath} on platform ${platform}`);
      return {
        success: false,
        error: 'No matching import flow found'
      };
    }
    
    // Create temporary directory for conversion
    const tempDir = await allocateTempSubdir();
    const inputDir = join(tempDir, 'in');
    const outputDir = join(tempDir, 'out');
    await ensureDir(inputDir);
    await ensureDir(outputDir);
    
    // Infer workspace source path from flow
    const workspaceSourcePath = inferWorkspaceSourcePath(
      matchingFlow,
      registryPath,
      platform
    );
    
    // Write workspace content to temp input file
    const inputFilePath = join(inputDir, workspaceSourcePath);
    await ensureDir(join(inputFilePath, '..'));
    await writeTextFile(inputFilePath, workspaceContent);
    
    // Build flow context for conversion
    const flowContext: FlowContext = {
      workspaceRoot: outputDir,  // Output goes to outputDir
      packageRoot: inputDir,     // Input comes from inputDir
      platform: platform,        // Source platform
      packageName: 'temp',
      direction: 'install',      // Import flows are used during "install" direction
      variables: {
        name: 'temp',
        version: '0.0.0',
        platform: platform,           // For conditionals: $$platform
        source: platform,             // For conditionals: $$source
        sourcePlatform: platform,
        targetPlatform: 'openpackage'
      },
      dryRun: false
    };
    
    // Execute the flow
    const executor = createFlowExecutor();
    const concreteFlow: Flow = {
      ...matchingFlow,
      from: workspaceSourcePath  // Use concrete file path
    };
    
    const flowResult = await executor.executeFlow(concreteFlow, flowContext);
    
    if (!flowResult.success) {
      return {
        success: false,
        error: `Flow execution failed: ${flowResult.error?.message}`
      };
    }
    
    // Read converted content
    if (typeof flowResult.target !== 'string') {
      return {
        success: false,
        error: 'Flow did not produce target path'
      };
    }
    
    const outputFilePath = flowResult.target;
    if (!(await exists(outputFilePath))) {
      return {
        success: false,
        error: 'Flow did not produce output file'
      };
    }
    
    const convertedContent = await readTextFile(outputFilePath);
    const convertedHash = await calculateFileHash(convertedContent);
    
    logger.debug(
      `Successfully converted ${registryPath} from ${platform} format to universal`,
      { 
        originalHash: await calculateFileHash(workspaceContent),
        convertedHash 
      }
    );
    
    return {
      success: true,
      convertedContent,
      convertedHash
    };
    
  } catch (error) {
    logger.warn(
      `Conversion failed for ${registryPath} (platform: ${platform})`,
      { error }
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Find matching import flow for a registry path
 * 
 * Searches through import flows to find one whose 'to' pattern matches
 * the registry path. Also evaluates conditional 'when' clauses.
 * 
 * @param flows - Array of import flows
 * @param registryPath - Universal registry path to match
 * @param platform - Platform context for conditional evaluation
 * @param workspaceRoot - Workspace root for context
 * @returns Matching flow or undefined
 */
function findMatchingImportFlow(
  flows: Flow[],
  registryPath: string,
  platform: Platform,
  workspaceRoot: string
): Flow | undefined {
  for (const flow of flows) {
    // Check if 'to' pattern matches registry path
    const toPattern = Array.isArray(flow.to) ? flow.to[0] : flow.to;
    
    // Handle switch expressions
    if (typeof toPattern === 'object' && '$switch' in toPattern) {
      // Skip switch expressions for now - would need full context to resolve
      logger.debug('Skipping flow with switch expression in to field');
      continue;
    }
    
    if (typeof toPattern !== 'string') {
      continue;
    }
    
    // Check if registry path matches the 'to' pattern
    if (!minimatch(registryPath, toPattern, { dot: true })) {
      continue;
    }
    
    // Check conditional 'when' clause if present
    if (flow.when) {
      const conditionMet = evaluateWhenCondition(flow.when, platform, workspaceRoot);
      if (!conditionMet) {
        logger.debug(`Flow condition not met for ${registryPath}`, { when: flow.when });
        continue;
      }
    }
    
    // Found matching flow
    return flow;
  }
  
  return undefined;
}

/**
 * Evaluate 'when' conditional clause
 * 
 * Simplified evaluation for common patterns used in platforms.jsonc.
 * Handles $eq and $ne comparisons with $$platform and $$source variables.
 * 
 * @param when - Conditional expression
 * @param platform - Current platform
 * @param workspaceRoot - Workspace root
 * @returns True if condition is met
 */
function evaluateWhenCondition(
  when: any,
  platform: Platform,
  workspaceRoot: string
): boolean {
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
  
  // Handle { "exists": "AGENTS.md" }
  if (when.exists) {
    // For save, we're converting workspace → universal
    // The 'exists' check is relative to source (workspace in this case)
    // For simplicity, assume file exists if we got to this point
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
 * Infer workspace source path from flow definition
 * 
 * For import flows, 'from' specifies the workspace path pattern.
 * We need to construct the specific file path that would be in workspace.
 * 
 * @param flow - Import flow
 * @param registryPath - Universal registry path
 * @param platform - Platform context
 * @returns Workspace source path
 */
function inferWorkspaceSourcePath(
  flow: Flow,
  registryPath: string,
  platform: Platform
): string {
  const fromPattern = Array.isArray(flow.from) ? flow.from[0] : flow.from;
  
  // Handle switch expressions
  if (typeof fromPattern === 'object' && '$switch' in fromPattern) {
    // For now, can't resolve without full context - use registry path
    logger.debug('Cannot infer source path from switch expression, using registry path');
    return registryPath;
  }
  
  if (typeof fromPattern !== 'string') {
    return registryPath;
  }
  
  // If 'from' is a glob pattern, we need to construct the specific path
  // Example: from ".cursor/mcp.json" and registryPath "mcp.jsonc"
  // We should use ".cursor/mcp.json" as the source path
  
  // If the pattern contains glob wildcards, try to map registry path to source path
  if (fromPattern.includes('**') || fromPattern.includes('*')) {
    // Extract base directory from pattern
    const baseDir = fromPattern.split('**')[0].replace(/\*+/g, '');
    
    // Extract file/subpath from registry path relative to 'to' pattern
    const toPattern = Array.isArray(flow.to) ? flow.to[0] : flow.to;
    if (typeof toPattern === 'string' && toPattern.includes('**')) {
      const toBase = toPattern.split('**')[0];
      const subPath = registryPath.startsWith(toBase) 
        ? registryPath.slice(toBase.length)
        : registryPath;
      return `${baseDir}${subPath}`;
    }
    
    // Fallback: use registry path
    return registryPath;
  }
  
  // For non-glob patterns, use the pattern as-is
  return fromPattern;
}

/**
 * Convert source (universal) content to workspace platform-specific format
 * 
 * Applies platform export flows to transform universal content to workspace format.
 * This is used for forward parity checking: verifying that workspace file matches
 * what would be produced by exporting the source.
 * 
 * @param sourceContent - Content from universal source file
 * @param platform - Target platform (e.g., 'cursor', 'claude')
 * @param sourceRegistryPath - Source registry path (e.g., 'mcp.json')
 * @param workspacePath - Expected workspace path (e.g., '.cursor/mcp.json')
 * @param workspaceRoot - Absolute path to workspace root
 * @returns Conversion result with converted content and hash
 */
export async function convertSourceToWorkspace(
  sourceContent: string,
  platform: Platform,
  sourceRegistryPath: string,
  workspacePath: string,
  workspaceRoot: string
): Promise<ConversionResult> {
  try {
    // Get platform definition and export flows
    const platformDef = getPlatformDefinition(platform, workspaceRoot);
    const platformExportFlows = platformDef.export || [];
    const globalExportFlows = getGlobalExportFlows(workspaceRoot) || [];
    const allExportFlows = [...globalExportFlows, ...platformExportFlows];
    
    if (allExportFlows.length === 0) {
      return {
        success: false,
        error: 'No export flows defined for platform'
      };
    }
    
    // Find matching export flow
    const matchingFlow = findMatchingExportFlow(
      allExportFlows,
      sourceRegistryPath,
      workspacePath,
      platform,
      workspaceRoot
    );
    
    if (!matchingFlow) {
      return {
        success: false,
        error: 'No matching export flow found'
      };
    }
    
    
    // Create temporary directory for conversion
    const tempDir = await allocateTempSubdir();
    const inputDir = join(tempDir, 'in');
    const outputDir = join(tempDir, 'out');
    await ensureDir(inputDir);
    await ensureDir(outputDir);
    
    // Write source content to temp input file
    const inputFilePath = join(inputDir, sourceRegistryPath);
    await ensureDir(join(inputFilePath, '..'));
    await writeTextFile(inputFilePath, sourceContent);
    
    // Build flow context for export
    const flowContext: FlowContext = {
      workspaceRoot: outputDir,  // Output goes to outputDir
      packageRoot: inputDir,     // Input comes from inputDir
      platform: platform,
      packageName: 'temp',
      direction: 'install',      // Export flows are used during "install" direction
      variables: {
        name: 'temp',
        version: '0.0.0',
        platform: platform,
        source: 'openpackage',
        sourcePlatform: 'openpackage',
        targetPlatform: platform,
        targetRoot: './'
      },
      dryRun: false
    };
    
    // Execute the flow
    const executor = createFlowExecutor();
    const flowResult = await executor.executeFlow(matchingFlow, flowContext);
    
    if (!flowResult.success) {
      return {
        success: false,
        error: `Flow execution failed: ${flowResult.error?.message}`
      };
    }
    
    // Read converted content
    if (typeof flowResult.target !== 'string') {
      return {
        success: false,
        error: 'Flow did not produce target path'
      };
    }
    
    const outputFilePath = flowResult.target;
    if (!(await exists(outputFilePath))) {
      return {
        success: false,
        error: 'Flow did not produce output file'
      };
    }
    
    const convertedContent = await readTextFile(outputFilePath);
    const convertedHash = await calculateFileHash(convertedContent);
    
    logger.debug(
      `Successfully forward converted ${sourceRegistryPath} to ${platform} format`,
      {
        originalHash: await calculateFileHash(sourceContent),
        convertedHash
      }
    );
    
    return {
      success: true,
      convertedContent,
      convertedHash
    };
    
  } catch (error) {
    logger.warn(
      `Forward conversion failed for ${sourceRegistryPath} (platform: ${platform})`,
      { error }
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Find matching export flow for source → workspace conversion
 * 
 * @param flows - Array of export flows
 * @param sourceRegistryPath - Source registry path
 * @param workspacePath - Target workspace path
 * @param platform - Platform context
 * @param workspaceRoot - Workspace root
 * @returns Matching flow or undefined
 */
function findMatchingExportFlow(
  flows: Flow[],
  sourceRegistryPath: string,
  workspacePath: string,
  platform: Platform,
  workspaceRoot: string
): Flow | undefined {
  for (const flow of flows) {
    // Check if 'from' pattern matches source registry path
    const fromPatterns = Array.isArray(flow.from) ? flow.from : [flow.from];
    
    if (fromPatterns.some(p => typeof p === 'object' && '$switch' in p)) {
      continue; // Skip switch expressions
    }
    
    if (fromPatterns.some(p => typeof p !== 'string')) {
      continue;
    }
    
    const matchesFrom = fromPatterns.some(p =>
      typeof p === 'string' && minimatch(sourceRegistryPath, p, { dot: true })
    );
    if (!matchesFrom) continue;
    
    // Check conditional 'when' clause if present
    if (flow.when) {
      const conditionMet = evaluateWhenCondition(flow.when, platform, workspaceRoot);
      if (!conditionMet) {
        continue;
      }
    }
    
    // Found matching flow
    return flow;
  }
  
  return undefined;
}

/**
 * Compute and cache the comparable hash for a candidate.
 * 
 * For merged files, extracts the package contribution first.
 * For platform-specific files, converts to universal format.
 * The result is cached on `candidate.comparableHash` for reuse.
 */
export async function ensureComparableHash(
  candidate: SaveCandidate,
  workspaceRoot: string
): Promise<string> {
  if (candidate.comparableHash !== undefined) {
    return candidate.comparableHash;
  }

  let hash = candidate.contentHash;

  if (candidate.mergeStrategy && candidate.mergeKeys && candidate.mergeKeys.length > 0) {
    const extractResult = await extractPackageContribution(candidate);
    if (extractResult.success && extractResult.extractedHash) {
      hash = extractResult.extractedHash;
      if (extractResult.extractedContent) {
        candidate.extractedContent = extractResult.extractedContent;
      }
    } else {
      hash = await calculateConvertedHash(candidate, workspaceRoot);
    }
  } else {
    hash = await calculateConvertedHash(candidate, workspaceRoot);
  }

  candidate.comparableHash = hash;
  return hash;
}

/**
 * Clear the conversion cache
 * 
 * Should be called at the end of save pipeline to free memory.
 */
export function clearConversionCache(): void {
  conversionCache.clear();
}
