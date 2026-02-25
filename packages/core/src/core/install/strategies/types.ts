/**
 * Strategy Types Module
 * 
 * Shared types and interfaces for installation strategies.
 */

import type { Flow } from '../../../types/flows.js';
import type { Platform } from '../../platforms.js';
import type { InstallOptions } from '../../../types/index.js';
import type { PackageFormat } from '../format-detector.js';
import type { PackageConversionContext } from '../../../types/conversion-context.js';

import type { RelocatedFile, OwnershipContext } from '../conflicts/file-conflict-resolver.js';
import type { IndexWriteCollector } from '../wave-resolver/index-write-collector.js';

/**
 * Installation context
 */
export interface FlowInstallContext {
  packageName: string;
  packageRoot: string;
  workspaceRoot: string;
  platform: Platform;
  packageVersion: string;
  priority: number;
  dryRun: boolean;
  packageFormat?: PackageFormat;
  
  /**
   * Conversion context for tracking package format identity and history
   * 
   * REQUIRED: Provides canonical source for `$$source` and `$$platform` variables in flow conditionals.
   * Contains immutable originalFormat and conversion history for auditing.
   */
  conversionContext: PackageConversionContext;
  
  // Phase 4: Resource filtering fields
  
  /**
   * Pattern that matched for base detection (for pattern-based filtering)
   */
  matchedPattern?: string;

  /**
   * Optional prompt port for interactive conflict resolution.
   * Threaded from ExecutionContext to avoid falling back to nonInteractivePrompt.
   */
  prompt?: import('../../ports/prompt.js').PromptPort;

  /**
   * Pre-built ownership context shared across parallel installs within a wave.
   * When present, the flow-based strategy skips building its own context.
   */
  sharedOwnershipContext?: OwnershipContext;

  /**
   * Index write collector for deferred writes during parallel installs.
   */
  indexWriteCollector?: IndexWriteCollector;
}

/**
 * Installation result
 */
export interface FlowInstallResult {
  success: boolean;
  filesProcessed: number;
  filesWritten: number;
  conflicts: FlowConflictReport[];
  errors: FlowInstallError[];
  targetPaths: string[];
  fileMapping: Record<string, any[]>;
  /** True when namespace conflict resolution was triggered for this package */
  namespaced?: boolean;
  /** Files that were physically relocated on disk during namespace resolution */
  relocatedFiles?: RelocatedFile[];
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

/**
 * Installation strategy interface
 */
export interface InstallationStrategy {
  /**
   * Check if this strategy can handle the given format/platform combination
   */
  canHandle(format: PackageFormat, platform: Platform): boolean;
  
  /**
   * Execute installation
   */
  install(
    context: FlowInstallContext,
    options?: InstallOptions,
    forceOverwrite?: boolean
  ): Promise<FlowInstallResult>;
  
  /**
   * Strategy name for logging
   */
  readonly name: string;
}
