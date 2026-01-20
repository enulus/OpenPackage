import type { PackageYml } from '../../../types/index.js';
import type { PackageSource } from '../unified/context.js';
import type { InstallOptions } from '../../../types/index.js';

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
    
    /** For path sources: was this a tarball? */
    wasTarball?: boolean;
  };
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
   */
  load(
    source: PackageSource,
    options: InstallOptions,
    cwd: string
  ): Promise<LoadedPackage>;
  
  /**
   * Get display name for this source type
   */
  getDisplayName(source: PackageSource): string;
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
