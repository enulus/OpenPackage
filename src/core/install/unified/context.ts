import type { Platform } from '../../platforms.js';
import type { InstallOptions } from '../../../types/index.js';
import type { ResolvedPackage } from '../../dependency-resolver.js';
import type { WorkspaceIndex } from '../../../types/workspace-index.js';

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
  
  // Registry source fields
  registryPath?: string;
  
  // Path source fields
  localPath?: string;
  sourceType?: 'directory' | 'tarball';
  
  // Git source fields
  gitUrl?: string;
  gitRef?: string;
  gitPath?: string;
  
  // Git source override for manifest recording
  // Used when physical source is path-based but logical source is git
  // (e.g., marketplace plugins loaded from already-cloned repos)
  gitSourceOverride?: {
    gitUrl: string;
    gitRef?: string;
    gitPath?: string;
  };
  
  // Content filter - when specified, only load files under this subdirectory path
  // Used for installing individual content items (skills, agents, etc.) from collections
  // Example: "skills/git" or "agents/code-review-assistant"
  contentFilter?: string;
  
  // Content type - identifies what type of content is being installed
  // Used to determine discovery strategy and naming conventions
  contentType?: 'skills' | 'agents';
  
  // Resolved content root (populated after loading)
  contentRoot?: string;
  
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
    
    /** Skill-specific metadata (for skills from marketplaces or standalone) */
    skillMetadata?: {
      skill: any; // DiscoveredSkill type, avoiding circular dependency
      pluginName?: string;
    };
    
    /** Content-specific metadata (for content from collections - new unified approach) */
    contentMetadata?: {
      item: any; // ContentItem type, avoiding circular dependency
      pluginName?: string;
    };
    
    /** Indicates this is a skills collection (multiple skills, not a plugin) */
    isSkillsCollection?: boolean;
    
    /** Indicates this is a content collection (skills, agents, etc.) */
    isContentCollection?: boolean;
    
    /** Indicates this is a single skill package */
    isSkill?: boolean;
    
    /** Indicates this is a single content item (skill, agent, etc.) */
    isSingleContent?: boolean;
    
    /** Content type for content items */
    contentType?: 'skills' | 'agents';
  };
}

/**
 * Installation mode determines which phases to execute
 */
export type InstallationMode = 'install' | 'apply';

/**
 * Unified context for all installation operations
 * 
 * Context is mutable and updated by pipeline phases.
 * Each phase documents which fields it mutates.
 */
export interface InstallationContext {
  // === Configuration (set during context creation) ===
  /** Package source details */
  source: PackageSource;
  
  /** Installation mode (install vs apply) */
  mode: InstallationMode;
  
  /** CLI options passed by user */
  options: InstallOptions;
  
  /** Target platforms for installation */
  platforms: Platform[];
  
  /** Current working directory */
  cwd: string;
  
  /** Target directory for installation (usually '.') */
  targetDir: string;
  
  // === State (updated during pipeline execution) ===
  /** Resolved dependency tree (updated in resolve phase) */
  resolvedPackages: ResolvedPackage[];
  
  /** Warnings accumulated during execution */
  warnings: string[];
  
  /** Errors accumulated during execution */
  errors: string[];
  
  /** Workspace index (read in prepare, updated in execute phase) */
  workspaceIndex?: WorkspaceIndex;
}
