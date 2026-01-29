/**
 * Naming Context Builder Module
 * 
 * Provides fluent APIs for constructing naming contexts from various sources.
 * Ensures type safety and completeness of context data.
 */

import { join } from 'path';
import type {
  PackageNamingContext,
  PackageType,
  GitSource,
  PhysicalLocation,
  PackageMetadata,
  SkillInfo,
  MarketplaceInfo
} from './naming-context.js';
import { validateNamingContext } from './naming-context.js';

/**
 * Base builder with common functionality
 */
abstract class BaseContextBuilder<T extends BaseContextBuilder<T>> {
  protected gitSource: GitSource = { url: '' };
  protected physical: PhysicalLocation = { contentRoot: '' };
  protected metadata: PackageMetadata = {};
  
  /**
   * Set Git URL
   */
  withGitUrl(url: string): T {
    this.gitSource.url = url;
    return this as unknown as T;
  }
  
  /**
   * Set Git ref (branch, tag, or commit)
   */
  withGitRef(ref: string | undefined): T {
    this.gitSource.ref = ref;
    return this as unknown as T;
  }
  
  /**
   * Set Git path (relative to repository root)
   */
  withGitPath(path: string | undefined): T {
    this.gitSource.path = path;
    return this as unknown as T;
  }
  
  /**
   * Set complete Git source information
   */
  withGit(url: string, ref: string | undefined, path: string | undefined): T {
    this.gitSource = { url, ref, path };
    return this as unknown as T;
  }
  
  /**
   * Set physical content root
   */
  withContentRoot(contentRoot: string): T {
    this.physical.contentRoot = contentRoot;
    return this as unknown as T;
  }
  
  /**
   * Set repository root (if different from content root)
   */
  withRepoRoot(repoRoot: string): T {
    this.physical.repoRoot = repoRoot;
    return this as unknown as T;
  }
  
  /**
   * Set physical location information
   */
  withPhysical(contentRoot: string, repoRoot?: string): T {
    this.physical = { contentRoot, repoRoot };
    return this as unknown as T;
  }
  
  /**
   * Set package metadata name
   */
  withMetadataName(name: string): T {
    this.metadata.name = name;
    return this as unknown as T;
  }
  
  /**
   * Set package metadata version
   */
  withMetadataVersion(version: string): T {
    this.metadata.version = version;
    return this as unknown as T;
  }
  
  /**
   * Set complete package metadata
   */
  withMetadata(name: string | undefined, version: string | undefined): T {
    this.metadata = { name, version };
    return this as unknown as T;
  }
  
  /**
   * Build the final context (to be implemented by subclasses)
   */
  abstract build(): PackageNamingContext;
}

/**
 * Builder for plugin naming contexts
 */
export class PluginContextBuilder extends BaseContextBuilder<PluginContextBuilder> {
  private marketplaceInfo?: MarketplaceInfo;
  
  /**
   * Set marketplace information (if plugin is from a marketplace)
   */
  withMarketplace(name: string, commitSha: string, pluginName?: string): PluginContextBuilder {
    this.marketplaceInfo = { name, commitSha, pluginName };
    return this;
  }
  
  build(): PackageNamingContext {
    const context: PackageNamingContext = {
      type: 'plugin',
      git: this.gitSource,
      physical: this.physical,
      metadata: this.metadata,
      marketplace: this.marketplaceInfo
    };
    
    validateNamingContext(context);
    return context;
  }
}

/**
 * Builder for skill naming contexts
 */
export class SkillContextBuilder extends BaseContextBuilder<SkillContextBuilder> {
  private skillInfo?: SkillInfo;
  private marketplaceInfo?: MarketplaceInfo;
  
  /**
   * Set skill information
   * 
   * @param name - Skill name
   * @param parentPath - Path to parent container (e.g., "plugins/ui-design")
   * @param relativePath - Path relative to parent (e.g., "skills/mobile-ios-design")
   */
  withSkillInfo(name: string, parentPath: string, relativePath: string): SkillContextBuilder {
    this.skillInfo = { name, parentPath, relativePath };
    
    // Auto-compute complete Git path if not already set
    if (!this.gitSource.path) {
      this.gitSource.path = join(parentPath, relativePath).replace(/\\/g, '/');
    }
    
    return this;
  }
  
  /**
   * Set marketplace information (if skill is from a marketplace)
   */
  withMarketplace(name: string, commitSha: string, pluginName: string): SkillContextBuilder {
    this.marketplaceInfo = { name, commitSha, pluginName };
    return this;
  }
  
  /**
   * Override Git path with explicit value.
   * Use this when you have the complete path pre-computed.
   */
  withCompleteGitPath(path: string): SkillContextBuilder {
    this.gitSource.path = path;
    return this;
  }
  
  build(): PackageNamingContext {
    if (!this.skillInfo) {
      throw new Error('Skill context requires skill information. Call withSkillInfo() before build()');
    }
    
    const context: PackageNamingContext = {
      type: 'skill',
      git: this.gitSource,
      physical: this.physical,
      metadata: this.metadata,
      skill: this.skillInfo,
      marketplace: this.marketplaceInfo
    };
    
    validateNamingContext(context);
    return context;
  }
}

/**
 * Builder for regular package naming contexts
 */
export class PackageContextBuilder extends BaseContextBuilder<PackageContextBuilder> {
  build(): PackageNamingContext {
    const context: PackageNamingContext = {
      type: 'package',
      git: this.gitSource,
      physical: this.physical,
      metadata: this.metadata
    };
    
    validateNamingContext(context);
    return context;
  }
}

/**
 * Builder for marketplace naming contexts
 */
export class MarketplaceContextBuilder extends BaseContextBuilder<MarketplaceContextBuilder> {
  private marketplaceInfo?: MarketplaceInfo;
  
  /**
   * Set marketplace information
   */
  withMarketplace(name: string, commitSha: string): MarketplaceContextBuilder {
    this.marketplaceInfo = { name, commitSha };
    return this;
  }
  
  build(): PackageNamingContext {
    if (!this.marketplaceInfo) {
      throw new Error('Marketplace context requires marketplace information. Call withMarketplace() before build()');
    }
    
    const context: PackageNamingContext = {
      type: 'marketplace',
      git: this.gitSource,
      physical: this.physical,
      metadata: this.metadata,
      marketplace: this.marketplaceInfo
    };
    
    validateNamingContext(context);
    return context;
  }
}
