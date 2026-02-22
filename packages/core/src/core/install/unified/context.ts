import type { Platform } from '../../platforms.js';
import type { InstallOptions, ExecutionContext } from '../../../types/index.js';
import type { ResolvedPackage } from '../../dependency-resolver/types.js';
import type { WorkspaceIndex } from '../../../types/workspace-index.js';
import type { ConflictSummary } from '../operations/installation-executor.js';

/**
 * Source information for package installation
 */
export interface PackageSource {
  /** Source type determines how package is loaded */
  type: 'registry' | 'path' | 'git' | 'workspace';
  
  /** Package name (required for all sources) */
  packageName: string;
  
  /** Version (optional for path/git sources) */
  version?: string;
  
  /** Resource-specific version (for agent/skill installations) */
  resourceVersion?: string;
  
  // Registry source fields
  registryPath?: string;
  
  // Path source fields
  localPath?: string;
  sourceType?: 'directory' | 'tarball';
  
  // Git source fields
  gitUrl?: string;
  gitRef?: string;
  gitPath?: string;
  
  // Resource model fields (Phase 2)
  /** Resource path within the source (for git/registry sources) */
  resourcePath?: string;
  
  /** Detected base for this resource */
  detectedBase?: string;
  
  /** Base path from manifest (Phase 5: for reproducibility during bulk install) */
  manifestBase?: string;
  
  // Git source override for manifest recording
  // Used when physical source is path-based but logical source is git
  // (e.g., marketplace plugins loaded from already-cloned repos)
  gitSourceOverride?: {
    gitUrl: string;
    gitRef?: string;
    gitPath?: string;
  };
  
  // Resolved content root (populated after loading)
  contentRoot?: string;
  
  /** Internal flag: Base detection has been performed (prevents redundant detection) */
  _baseDetectionPerformed?: boolean;
  
  // Plugin-specific metadata (populated during source loading)
  pluginMetadata?: {
    /** Whether this is a Claude Code plugin */
    isPlugin: boolean;
    
    /** Type of plugin */
    pluginType?: 'individual' | 'marketplace' | 'marketplace-defined';
    
    /** Package format metadata (from plugin transformer) */
    format?: any;
    
    /** Manifest path (for marketplaces) */
    manifestPath?: string;
    
    /** Marketplace entry for marketplace-defined plugins */
    marketplaceEntry?: any; // Will be MarketplacePluginEntry but avoiding circular dependency
    
    /** Marketplace source info (for workspace index) */
    marketplaceSource?: {
      url: string;
      commitSha: string;
      pluginName: string;
    };
  };
}

/**
 * Unified context for all installation operations
 * 
 * Context is mutable and updated by pipeline phases.
 * Each phase documents which fields it mutates.
 */
export interface InstallationContext {
  // === Execution Context (single source of truth for directories) ===
  /** Execution context containing sourceCwd, targetDir, and isGlobal */
  execution: ExecutionContext;
  
  // === Convenience Aliases ===
  /** Alias to execution.targetDir for easier access */
  targetDir: string;
  
  // === Configuration (set during context creation) ===
  /** Package source details */
  source: PackageSource;
  
  /** Installation mode (install vs apply) */
  mode: 'install' | 'apply';
  
  /** CLI options passed by user */
  options: InstallOptions;
  
  /** Target platforms for installation */
  platforms: Platform[];
  
  // === State (updated during pipeline execution) ===
  /** Resolved dependency tree (updated in resolve phase) */
  resolvedPackages: ResolvedPackage[];
  
  /** Warnings accumulated during execution */
  warnings: string[];
  
  /** Errors accumulated during execution */
  errors: string[];
  
  /** Workspace index (read in prepare, updated in execute phase) */
  workspaceIndex?: WorkspaceIndex;
  
  // === Resource model fields (Phase 2) ===
  /** Detected base path (absolute) */
  detectedBase?: string;
  
  /** Detected base relative to repo root (for manifest) */
  baseRelative?: string;
  
  /** How base was determined */
  baseSource?: 'openpackage' | 'plugin' | 'marketplace' | 'pattern' | 'user-selection' | 'manifest';
  
  /** Pattern that matched (for pattern-based detection) */
  matchedPattern?: string;
  
  /** Internal flag: Path scoping has been computed (prevents redundant computation) */
  _pathScopingPerformed?: boolean;
  
  /** Ambiguous matches awaiting user resolution */
  ambiguousMatches?: Array<{
    pattern: string;
    base: string;
    startIndex: number;
  }>;
  
  // === Format detection and conversion (Phase 4) ===
  /** Format detection result (set during load phase) */
  formatDetection?: import('../detection-types.js').EnhancedPackageFormat;
  
  /** Whether package was pre-converted to universal format */
  wasPreConverted?: boolean;
  
  /** Conversion errors (non-fatal, logged but don't stop installation) */
  conversionErrors?: Error[];

  // === Conflict resolution results (set during conflicts phase) ===
  /**
   * Result from the package-level conflict phase.
   * Carries forceOverwritePackages (packages the user confirmed to overwrite)
   * and skippedPackages (packages removed from the install set).
   */
  conflictResult?: ConflictSummary;
}
