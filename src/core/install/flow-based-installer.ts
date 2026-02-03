/**
 * Flow-Based Installer Module
 * 
 * Handles installation of package files using the declarative flow system.
 * Integrates with the existing install pipeline to execute flow transformations
 * for each package file, with multi-package composition and priority-based merging.
 * 
 * This module now serves as a thin orchestration layer, delegating to specialized
 * strategy implementations for different installation scenarios.
 * 
 * CORE LAYER: Pure flow execution logic
 * For workspace-integrated installation with index updates, see flow-index-installer.ts
 */

import type { InstallOptions } from '../../types/index.js';
import { platformUsesFlows } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import {
  selectInstallStrategy,
  type FlowInstallContext,
  type FlowInstallResult,
  type FlowConflictReport,
  type FlowInstallError
} from './strategies/index.js';
import { detectFormatFromDirectory } from './helpers/format-detection.js';
import { logInstallationResult } from './helpers/result-logging.js';
// Re-export types for backward compatibility
export type {
  FlowInstallContext,
  FlowInstallResult,
  FlowConflictReport,
  FlowInstallError
};

// ============================================================================
// Main Installation API
// ============================================================================

/**
 * Execute flows for a single package installation with format detection and conversion
 * 
 * This is the main entry point for flow-based installation. It:
 * 1. Detects the package format (universal vs platform-specific)
 * 2. Selects the appropriate installation strategy
 * 3. Delegates to the strategy for execution
 * 
 * @param installContext - Installation context with package metadata
 * @param options - Installation options (e.g., dryRun)
 * @returns Installation result with file mappings and metrics
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
      logger.debug(`Platform ${platform} does not use flows, skipping flow-based installation`);
      return result;
    }
    
    // Phase 1: Get or detect package format
    const packageFormat = installContext.packageFormat || 
      await detectFormatFromDirectory(packageRoot);
    
    logger.debug('Package format', {
      package: packageName,
      type: packageFormat.type,
      platform: packageFormat.platform,
      confidence: packageFormat.confidence,
      targetPlatform: platform,
      source: installContext.packageFormat ? 'provided' : 'detected'
    });
    
    // Phase 2: Select and execute installation strategy
    const enrichedContext: FlowInstallContext = {
      ...installContext,
      packageFormat
    };
    
    const strategy = selectInstallStrategy(enrichedContext, options);
    const strategyResult = await strategy.install(enrichedContext, options);
    
    // Log results using shared utility
    logInstallationResult(strategyResult, packageName, platform, dryRun ?? false);
    
    return strategyResult;
    
  } catch (error) {
    result.success = false;
    logger.error(`Failed to install package ${packageName} with flows: ${(error as Error).message}`);
    result.errors.push({
      flow: { from: packageRoot, to: workspaceRoot },
      sourcePath: packageRoot,
      error: error as Error,
      message: `Installation failed: ${(error as Error).message}`
    });
    return result;
  }
}
