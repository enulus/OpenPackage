import type { InstallOptions, ExecutionContext } from '../../../types/index.js';
import type { InstallResolutionMode } from '../types.js';
import type { InstallationContext } from '../unified/context.js';

/**
 * Normalized install options after CLI boundary processing.
 * All optional values are resolved to concrete values.
 */
export interface NormalizedInstallOptions extends InstallOptions {
  platforms: string[] | undefined;
  plugins: string[] | undefined;
  conflictStrategy: NonNullable<InstallOptions['conflictStrategy']>;
  resolutionMode: InstallResolutionMode;
  agents?: string[];
  skills?: string[];
  rules?: string[];
  commands?: string[];
  interactive?: boolean;
}

/**
 * Result of preprocessing a context before pipeline execution.
 */
export interface PreprocessResult {
  /** The processed context (may be modified) */
  context: InstallationContext;
  
  /** Special handling required */
  specialHandling?: 'marketplace' | 'ambiguous' | 'multi-resource';
  
  /** Marketplace manifest (when specialHandling is 'marketplace') */
  marketplaceManifest?: any;
  
  /** Ambiguous matches (when specialHandling is 'ambiguous') */
  ambiguousMatches?: Array<{ pattern: string; base: string; startIndex: number }>;
  
  /** Multiple resource contexts (when specialHandling is 'multi-resource') */
  resourceContexts?: InstallationContext[];

  /** Workspace root context for bulk install (run as distinct stage, not in dependency loop) */
  workspaceContext?: InstallationContext | null;
}

/**
 * Strategy interface for handling different source types.
 */
export interface InstallStrategy {
  /** Strategy name for debugging */
  readonly name: string;
  
  /** Check if this strategy can handle the given classification */
  canHandle(classification: InputClassification): boolean;
  
  /** Build initial context from classification */
  buildContext(
    classification: InputClassification,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<InstallationContext>;
  
  /** Preprocess context (load source, detect base, etc.) */
  preprocess(
    context: InstallationContext,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<PreprocessResult>;
}

/**
 * Feature flags indicating what capabilities are needed for install.
 */
export interface InputFeatures {
  /** Source has sub-resource path (e.g., gh@user/repo/agents/foo) */
  hasResourcePath: boolean;
  /** User specified --agents, --skills, --rules, or --commands convenience filters */
  hasConvenienceFilters: boolean;
}

/**
 * Base classification with common features.
 */
interface BaseClassification {
  features: InputFeatures;
}

/**
 * Bulk install (no input argument).
 */
export interface BulkClassification extends BaseClassification {
  type: 'bulk';
}

/**
 * Git-based source (GitHub URL or shorthand).
 */
export interface GitClassification extends BaseClassification {
  type: 'git';
  gitUrl: string;
  gitRef?: string;
  resourcePath?: string;
}

/**
 * Local filesystem path source.
 */
export interface PathClassification extends BaseClassification {
  type: 'path';
  localPath: string;
}

/**
 * Registry package source.
 */
export interface RegistryClassification extends BaseClassification {
  type: 'registry';
  packageName: string;
  version?: string;
  resourcePath?: string;
}

/**
 * Unified input classification result.
 */
export type InputClassification =
  | BulkClassification
  | GitClassification
  | PathClassification
  | RegistryClassification;
