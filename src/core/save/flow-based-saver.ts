/**
 * Flow-Based Saver
 * 
 * Handles reverse flow transformations for the save pipeline.
 * Transforms workspace platform-specific files back to universal package format.
 */

import { basename, dirname, join } from 'path';
import type { Platform } from '../platforms.js';
import { 
  getPlatformDefinition, 
  getGlobalImportFlows,
  platformUsesFlows,
  deriveRootDirFromFlows
} from '../platforms.js';
import type { Flow, FlowContext, FlowResult } from '../../types/flows.js';
import { createFlowExecutor } from '../flows/flow-executor.js';
import { logger } from '../../utils/logger.js';
import { exists, readTextFile, ensureDir, writeTextFile } from '../../utils/fs.js';
import type { SaveCandidate } from './save-types.js';
import { normalizeRegistryPath } from '../../utils/registry-entry-filter.js';

/**
 * Options for flow-based save operation
 */
export interface FlowSaveOptions {
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Result of saving a file via flows
 */
export interface FlowSaveFileResult {
  success: boolean;
  sourceWorkspacePath: string;
  targetRegistryPath: string;
  transformed: boolean;
  error?: Error;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Result of flow-based save operation
 */
export interface FlowSaveResult {
  success: boolean;
  filesProcessed: number;
  filesWritten: number;
  filesSkipped: number;
  fileResults: FlowSaveFileResult[];
  errors: Array<{ file: string; error: Error }>;
}

/**
 * Find the matching reverse flow for a workspace file
 * 
 * Reverse flow logic:
 * - Workspace file path matches the flow's 'to' pattern
 * - Transform workspace → package (reverse of install)
 * - Use the flow's 'from' pattern as the target in package
 */
function findReverseFlow(
  workspaceFilePath: string,
  platform: Platform,
  cwd: string
): { flow: Flow; registryPath: string } | null {
  try {
    const definition = getPlatformDefinition(platform, cwd);
    if (!definition.import || definition.import.length === 0) {
      return null;
    }
  } catch (error) {
    // Platform not found - return null to skip
    logger.debug(`Platform ${platform} not found: ${error}`);
    return null;
  }

  const definition = getPlatformDefinition(platform, cwd);

  // Get all applicable import flows (global + platform)
  const globalImportFlows = getGlobalImportFlows(cwd) ?? [];
  const allImportFlows = [...globalImportFlows, ...definition.import];

  // Normalize workspace path for matching
  const normalizedWorkspacePath = workspaceFilePath.replace(/\\/g, '/');

  for (const flow of allImportFlows) {
    // Import flows use 'from' to match workspace files
    // For array patterns in 'from', try each pattern
    const fromPatterns = Array.isArray(flow.from) ? flow.from : [flow.from];

    for (const fromPattern of fromPatterns) {
      // Match the workspace file against the 'from' pattern
      const rootDir = deriveRootDirFromFlows(definition);
      const match = matchWorkspacePathToPattern(normalizedWorkspacePath, fromPattern, rootDir);
      
      if (match) {
        // Extract variables from the match (e.g., {name})
        const variables = match.variables;
        
        // Resolve the 'to' pattern with extracted variables (destination in package)
        const toPattern = typeof flow.to === 'string' ? flow.to : Object.keys(flow.to)[0];
        const registryPath = resolvePattern(toPattern, variables);
        
        return { flow, registryPath };
      }
    }
  }

  return null;
}

/**
 * Match workspace path to a flow pattern
 * 
 * Examples:
 * - Pattern: ".cursor/rules/{name}.mdc" 
 *   Path: ".cursor/rules/typescript.mdc" → { match: true, variables: { name: "typescript" } }
 */
interface PatternMatch {
  variables: Record<string, string>;
}

function matchWorkspacePathToPattern(
  workspacePath: string,
  pattern: string,
  rootDir: string
): PatternMatch | null {
  // Normalize both paths
  const normalizedPath = workspacePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Extract pattern parts
  const patternParts = normalizedPattern.split('/');
  const pathParts = normalizedPath.split('/');

  // Must have same number of parts
  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const variables: Record<string, string> = {};

  // Match each part
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    // Check for variable placeholder {name}
    const varMatch = patternPart.match(/^\{(\w+)\}$/);
    if (varMatch) {
      variables[varMatch[1]] = pathPart;
      continue;
    }

    // Check for inline variable {name}.ext
    const inlineVarMatch = patternPart.match(/^(.*)\{(\w+)\}(.*)$/);
    if (inlineVarMatch) {
      const [, prefix = '', varName, suffix = ''] = inlineVarMatch;
      if (pathPart.startsWith(prefix) && pathPart.endsWith(suffix)) {
        const value = pathPart.slice(prefix.length, pathPart.length - suffix.length);
        variables[varName] = value;
        continue;
      }
    }

    // Exact match required
    if (patternPart !== pathPart) {
      return null;
    }
  }

  return { variables };
}

/**
 * Resolve a pattern with variables
 * 
 * Example: "rules/{name}.md" with { name: "typescript" } → "rules/typescript.md"
 */
function resolvePattern(pattern: string, variables: Record<string, string>): string {
  let resolved = pattern;
  
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.replace(`{${key}}`, value);
  }
  
  return resolved;
}

/**
 * Execute reverse flow transformation
 * 
 * Reverse transformations:
 * - Read workspace file
 * - Reverse key mapping (if any)
 * - Reverse format conversion (if any)
 * - Write to package registry path
 */
async function executeReverseFlow(
  workspaceFilePath: string,
  flow: Flow,
  registryPath: string,
  packageRoot: string,
  cwd: string,
  options: FlowSaveOptions
): Promise<FlowSaveFileResult> {
  const executor = createFlowExecutor();

  try {
    // Get relative path from workspace root
    const relativeWorkspacePath = workspaceFilePath.startsWith(cwd)
      ? workspaceFilePath.slice(cwd.length + 1).replace(/\\/g, '/')
      : workspaceFilePath;

    // Create reverse flow
    // For now, we'll do a simple copy - full reverse transformation coming later
    const reverseFlow: Flow = {
      from: relativeWorkspacePath,
      to: registryPath,
      // TODO: Implement full reverse transformation
      // - Reverse key mapping
      // - Reverse format conversion
      // - Reverse embed/extract
    };

    // Create flow context for save (reverse of install)
    // For save: source is workspace, target is package
    // So we swap the roots compared to install
    const context: FlowContext = {
      workspaceRoot: packageRoot, // Target for save (writes to package)
      packageRoot: cwd, // Source for save (reads from workspace)
      platform: '', // Not needed for reverse flow
      packageName: basename(packageRoot),
      variables: {},
      direction: 'save',
      dryRun: options.dryRun ?? false
    };

    // Execute the reverse flow
    const result: FlowResult = await executor.executeFlow(reverseFlow, context);

    if (!result.success) {
      return {
        success: false,
        sourceWorkspacePath: workspaceFilePath,
        targetRegistryPath: registryPath,
        transformed: false,
        error: result.error
      };
    }

    return {
      success: true,
      sourceWorkspacePath: workspaceFilePath,
      targetRegistryPath: registryPath,
      transformed: result.transformed ?? false
    };
  } catch (error) {
    return {
      success: false,
      sourceWorkspacePath: workspaceFilePath,
      targetRegistryPath: registryPath,
      transformed: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Check if a platform uses flows
 */
export function shouldUseFlowsForSave(platform: Platform | undefined, cwd: string): boolean {
  if (!platform) {
    return false;
  }
  return platformUsesFlows(platform, cwd);
}

/**
 * Save workspace files using reverse flows
 * 
 * Process:
 * 1. Group candidates by platform
 * 2. For each workspace candidate:
 *    - Find matching reverse flow
 *    - Execute reverse transformation
 *    - Write to package registry
 * 3. Return results
 */
export async function saveWorkspaceFilesWithFlows(
  workspaceCandidates: SaveCandidate[],
  packageRoot: string,
  cwd: string,
  options: FlowSaveOptions = {}
): Promise<FlowSaveResult> {
  const fileResults: FlowSaveFileResult[] = [];
  const errors: Array<{ file: string; error: Error }> = [];

  logger.debug(`Saving ${workspaceCandidates.length} workspace files using flows`);

  for (const candidate of workspaceCandidates) {
    // Skip candidates without platform info
    if (!candidate.platform) {
      fileResults.push({
        success: false,
        sourceWorkspacePath: candidate.fullPath,
        targetRegistryPath: candidate.registryPath,
        transformed: false,
        skipped: true,
        skipReason: 'No platform detected for file'
      });
      continue;
    }

    // Check if platform uses flows
    if (!shouldUseFlowsForSave(candidate.platform, cwd)) {
      fileResults.push({
        success: false,
        sourceWorkspacePath: candidate.fullPath,
        targetRegistryPath: candidate.registryPath,
        transformed: false,
        skipped: true,
        skipReason: `Platform ${candidate.platform} does not use flows`
      });
      continue;
    }

    // Find matching reverse flow
    const match = findReverseFlow(candidate.displayPath, candidate.platform, cwd);
    
    if (!match) {
      // No reverse flow found - skip this file (handled by legacy save)
      fileResults.push({
        success: false,
        sourceWorkspacePath: candidate.fullPath,
        targetRegistryPath: candidate.registryPath,
        transformed: false,
        skipped: true,
        skipReason: 'No matching reverse flow'
      });
      continue;
    }

    // Execute reverse flow
    const result = await executeReverseFlow(
      candidate.fullPath,
      match.flow,
      match.registryPath,
      packageRoot,
      cwd,
      options
    );

    fileResults.push(result);

    if (!result.success) {
      errors.push({
        file: candidate.fullPath,
        error: result.error ?? new Error('Unknown error')
      });
    }
  }

  // Calculate statistics
  const filesProcessed = fileResults.filter(r => !r.skipped).length;
  const filesWritten = fileResults.filter(r => r.success && !r.skipped).length;
  const filesSkipped = fileResults.filter(r => r.skipped).length;

  return {
    success: errors.length === 0,
    filesProcessed,
    filesWritten,
    filesSkipped,
    fileResults,
    errors
  };
}

/**
 * Get statistics from flow save result
 */
export function getFlowSaveStatistics(result: FlowSaveResult): {
  total: number;
  written: number;
  skipped: number;
  errors: number;
} {
  return {
    total: result.filesProcessed + result.filesSkipped,
    written: result.filesWritten,
    skipped: result.filesSkipped,
    errors: result.errors.length
  };
}
