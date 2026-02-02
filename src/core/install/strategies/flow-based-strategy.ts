/**
 * Standard Flow-Based Installation Strategy
 * 
 * Applies platform flows with full transformations.
 * Used for universal format packages.
 */

import type { Platform } from '../../platforms.js';
import type { PackageFormat } from '../format-detector.js';
import type { InstallOptions } from '../../../types/index.js';
import type { FlowInstallContext, FlowInstallResult } from './types.js';
import { BaseStrategy } from './base-strategy.js';
import { platformUsesFlows } from '../../platforms.js';
import { filterSourcesByPlatform } from './helpers/platform-filtering.js';
import { convertToInstallResult } from './helpers/result-converter.js';
import { discoverFlowSources } from '../../flows/flow-source-discovery.js';
import { executeFlowsForSources } from '../../flows/flow-execution-coordinator.js';
import { logger } from '../../../utils/logger.js';

/**
 * Standard Flow-Based Installation Strategy
 * 
 * Applies platform flows with full transformations.
 * Used for universal format packages.
 */
export class FlowBasedInstallStrategy extends BaseStrategy {
  readonly name = 'flow-based';
  
  canHandle(format: PackageFormat, platform: Platform): boolean {
    // Default strategy - handles all remaining cases
    return true;
  }
  
  async install(
    context: FlowInstallContext,
    options?: InstallOptions
  ): Promise<FlowInstallResult> {
    const { packageName, packageRoot, workspaceRoot, platform, dryRun } = context;
    
    this.logStrategySelection(context);
    
    logger.debug(`Standard flow-based installation for ${packageName}`);
    
    // Check if platform uses flows
    if (!platformUsesFlows(platform, workspaceRoot)) {
      logger.debug(`Platform ${platform} does not use flows, skipping flow-based installation`);
      return this.createEmptyResult();
    }
    
    // Get applicable flows
    const flows = this.getApplicableFlows(platform, workspaceRoot);
    if (flows.length === 0) {
      logger.debug(`No flows defined for platform ${platform}`);
      return this.createEmptyResult();
    }
    
    // Build context
    const flowContext = this.buildFlowContext(context, 'install');
    
    // Discover sources
    const flowSources = await discoverFlowSources(flows, packageRoot, flowContext);
    
    // Phase 4: Apply resource filtering if specified
    const resourceFilteredSources = this.applyResourceFiltering(
      flowSources,
      context.matchedPattern,
      context.resourceFilter,
      packageRoot
    );
    
    // Filter by platform
    const filteredSources = filterSourcesByPlatform(resourceFilteredSources, platform);
    
    // Execute flows
    const executionResult = await executeFlowsForSources(filteredSources, flowContext);
    
    // Convert to result
    const result = convertToInstallResult(executionResult, packageName, platform, dryRun);
    
    this.logResults(result, context);
    
    return result;
  }
}
