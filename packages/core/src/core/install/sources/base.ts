import type { PackageYml, ExecutionContext } from '../../../types/index.js';
import type { PackageSource } from '../unified/context.js';
import type { InstallOptions } from '../../../types/index.js';
import type { EnhancedPackageFormat } from '../detection-types.js';
import type { ConversionContext } from '../conversion-context.js';

/**
 * Result of loading a package from a source
 */
export interface LoadedPackage {
  /** Package metadata */
  metadata: PackageYml;
  
  /** Package name (from package.yml or derived) */
  packageName: string;
  
  /** Package version */
  version: string;
  
  /** Absolute path to package content root */
  contentRoot: string;
  
  /** Source type for tracking */
  source: 'registry' | 'path' | 'git' | 'workspace';
  
  /** Plugin-specific metadata (will be stored in context.source.pluginMetadata) */
  pluginMetadata?: {
    isPlugin: boolean;
    pluginType?: 'individual' | 'marketplace';
    format?: any;
    manifestPath?: string;
  };
  
  /** Additional source metadata */
  sourceMetadata?: {
    /** For git sources: repository path */
    repoPath?: string;
    
    /** For git sources: commit SHA of cached version */
    commitSha?: string;
    
    /** Base detection result (for resource model) */
    baseDetection?: any;
  };
  
  /**
   * Format detection metadata (Phase 4)
   * Set by conversion coordinator after format detection
   */
  formatDetection?: EnhancedPackageFormat;
  
  /**
   * Whether package was pre-converted (Phase 4)
   * True if package was converted from platform format to universal
   */
  preConverted?: boolean;
  
  /**
   * Conversion context (Phase 4)
   * Contains conversion metadata and statistics
   */
  conversionContext?: ConversionContext;
}

/**
 * Interface for package source loaders
 */
export interface PackageSourceLoader {
  /**
   * Check if this loader can handle the given source
   */
  canHandle(source: PackageSource): boolean;
  
  /**
   * Load package from the source
   * 
   * @param source - Package source information
   * @param options - Install options
   * @param execContext - Execution context (uses sourceCwd for resolving inputs)
   */
  load(
    source: PackageSource,
    options: InstallOptions,
    execContext: ExecutionContext
  ): Promise<LoadedPackage>;
}

/**
 * Base error for source loading failures
 */
export class SourceLoadError extends Error {
  constructor(
    public source: PackageSource,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'SourceLoadError';
  }
}
