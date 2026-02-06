/**
 * Save To Source Pipeline
 * 
 * This module orchestrates the complete save operation, integrating all phases:
 * - Phase 1: Validation
 * - Phase 2: Candidate Discovery & Grouping
 * - Phase 3: Platform Pruning & Filtering
 * - Phase 4: Conflict Analysis & Resolution
 * - Phase 5: File Writes
 * - Phase 6: Result Reporting
 * 
 * This is the main entry point for the enhanced save command.
 * 
 * @module save-to-source-pipeline
 */

import type { CommandResult } from '../../types/index.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';
import { assertMutableSourceOrThrow } from '../../utils/source-mutability.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { logger } from '../../utils/logger.js';
import { buildCandidates } from './save-candidate-builder.js';
import { buildCandidateGroups, filterGroupsWithWorkspace } from './save-group-builder.js';
import { analyzeGroup } from './save-conflict-analyzer.js';
import { executeResolution } from './save-resolution-executor.js';
import { pruneExistingPlatformCandidates } from './save-platform-handler.js';
import { writeResolution } from './save-write-coordinator.js';
import {
  buildSaveReport,
  createCommandResult,
  createSuccessResult,
  createErrorResult
} from './save-result-reporter.js';
import type { ConflictAnalysis } from './save-conflict-analyzer.js';
import type { WriteResult } from './save-types.js';

/**
 * Options for save-to-source pipeline
 */
export interface SaveToSourceOptions {
  /** Enable force mode (auto-select newest when conflicts occur) */
  force?: boolean;
}

/**
 * Validation result structure (internal)
 */
interface ValidationResult {
  valid: boolean;
  cwd?: string;
  packageRoot?: string;
  filesMapping?: Record<string, (string | WorkspaceIndexFileMapping)[]>;
  error?: string;
}

/**
 * Run the complete save-to-source pipeline
 * 
 * This is the main orchestrator function that coordinates all phases
 * of the save operation:
 * 
 * 1. **Validate preconditions**: Check package exists, is mutable, has files
 * 2. **Build candidates**: Discover files in workspace and source
 * 3. **Group candidates**: Organize by registry path
 * 4. **Prune platform candidates**: Remove candidates with existing platform files
 * 5. **Filter active groups**: Keep only groups with workspace changes
 * 6. **Analyze & resolve**: Classify conflicts and execute resolution strategies
 * 7. **Write files**: Execute file write operations
 * 8. **Report results**: Build and return comprehensive report
 * 
 * @param packageName - Package name to save
 * @param options - Save options (force mode, etc.)
 * @returns CommandResult with success status and report data
 */
export async function runSaveToSourcePipeline(
  packageName: string | undefined,
  options: SaveToSourceOptions = {}
): Promise<CommandResult> {
  // Phase 1: Validate preconditions
  logger.debug(`Validating save preconditions for ${packageName}`);
  const validation = await validateSavePreconditions(packageName);
  if (!validation.valid) {
    return createErrorResult(validation.error!);
  }
  
  const { cwd, packageRoot, filesMapping } = validation;
  
  // Phase 2: Build candidates from workspace and source
  logger.debug(`Building candidates for ${packageName}`);
  const candidateResult = await buildCandidates({
    packageRoot: packageRoot!,
    workspaceRoot: cwd!,
    filesMapping: filesMapping!
  });
  
  if (candidateResult.errors.length > 0) {
    logger.warn(`Encountered ${candidateResult.errors.length} error(s) building candidates`);
    candidateResult.errors.forEach(err =>
      logger.warn(`  ${err.path}: ${err.reason}`)
    );
  }
  
  // Phase 3: Build candidate groups (organize by registry path)
  logger.debug('Building candidate groups');
  const allGroups = buildCandidateGroups(
    candidateResult.localCandidates,
    candidateResult.workspaceCandidates
  );
  
  // Phase 4: Prune platform-specific candidates with existing files
  logger.debug('Pruning existing platform-specific files');
  await pruneExistingPlatformCandidates(packageRoot!, allGroups);
  
  // Phase 5: Filter to groups with workspace candidates
  const activeGroups = filterGroupsWithWorkspace(allGroups);
  
  if (activeGroups.length === 0) {
    logger.info(`No workspace changes detected for ${packageName}`);
    return createSuccessResult(
      packageName!,
      `✓ Saved ${packageName}\n  No workspace changes detected`
    );
  }
  
  logger.debug(`Processing ${activeGroups.length} group(s) with workspace candidates`);
  
  // Phase 6: Analyze groups and execute resolutions
  const analyses: ConflictAnalysis[] = [];
  const allWriteResults: WriteResult[][] = [];
  
  for (const group of activeGroups) {
    // Analyze the group
    const analysis = analyzeGroup(group, options.force ?? false);
    analyses.push(analysis);
    
    // Skip if no action needed
    if (analysis.type === 'no-action-needed' || analysis.type === 'no-change-needed') {
      logger.debug(`Skipping ${group.registryPath}: ${analysis.type}`);
      continue;
    }
    
    // Execute resolution strategy (pass packageRoot for parity checking)
    const resolution = await executeResolution(group, analysis, packageRoot!);
    if (!resolution) {
      logger.debug(`No resolution returned for ${group.registryPath}`);
      continue;
    }
    
    // Write resolved content to source
    const writeResults = await writeResolution(
      packageRoot!,
      group.registryPath,
      resolution,
      group.local
    );
    
    allWriteResults.push(writeResults);
  }
  
  // Phase 7: Build and format report
  logger.debug('Building save report');
  const report = buildSaveReport(packageName!, analyses, allWriteResults);
  
  // Phase 8: Return result
  return createCommandResult(report);
}

/**
 * Validate save preconditions
 * 
 * Performs comprehensive validation before attempting save operation:
 * - Package name is provided
 * - Workspace index exists and is readable
 * - Package exists in index
 * - Package has file mappings
 * - Package source is resolvable
 * - Source is mutable (not registry)
 * 
 * @param packageName - Package name to validate
 * @returns Validation result with success status and required data or error
 */
async function validateSavePreconditions(
  packageName: string | undefined
): Promise<ValidationResult> {
  const cwd = process.cwd();
  
  // Check package name provided
  if (!packageName) {
    return {
      valid: false,
      error: 'Package name is required for save.'
    };
  }
  
  // Read workspace index
  let index;
  try {
    const result = await readWorkspaceIndex(cwd);
    index = result.index;
  } catch (error) {
    return {
      valid: false,
      error: `Failed to read workspace index: ${error}`
    };
  }
  
  // Check package exists in index
  const pkgIndex = index.packages?.[packageName];
  if (!pkgIndex) {
    return {
      valid: false,
      error:
        `Package '${packageName}' is not installed in this workspace.\n` +
        `Run 'opkg install ${packageName}' to install it first.`
    };
  }
  
  // Check package has file mappings
  if (!pkgIndex.files || Object.keys(pkgIndex.files).length === 0) {
    return {
      valid: false,
      error:
        `Package '${packageName}' has no files installed.\n` +
        `Nothing to save.`
    };
  }
  
  // Resolve package source
  let source;
  try {
    source = await resolvePackageSource(cwd, packageName);
  } catch (error) {
    return {
      valid: false,
      error: `Failed to resolve package source: ${error}`
    };
  }
  
  // Check source is mutable
  try {
    assertMutableSourceOrThrow(source.absolutePath, {
      packageName: source.packageName,
      command: 'save'
    });
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  
  return {
    valid: true,
    cwd,
    packageRoot: source.absolutePath,
    filesMapping: pkgIndex.files
  };
}
