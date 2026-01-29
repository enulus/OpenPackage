/**
 * Package Name Service
 * 
 * Central authority for all package name resolution.
 * Single source of truth for generating package names consistently.
 */

import type { PackageNamingContext } from './naming-context.js';
import { validateNamingContext, summarizeNamingContext } from './naming-context.js';
import { generateGitHubPackageName } from '../../utils/plugin-naming.js';
import { logger } from '../../utils/logger.js';

/**
 * Manifest entry structure for openpackage.yml
 */
export interface ManifestEntry {
  name: string;
  version?: string;
  gitUrl?: string;
  gitRef?: string;
  gitPath?: string;
  path?: string;
}

/**
 * Index entry structure for openpackage.index.yml
 */
export interface IndexEntry {
  packageName: string;
  version: string;
  path: string;
  marketplace?: {
    url: string;
    commitSha: string;
    pluginName: string;
  };
}

/**
 * Package Name Service
 * 
 * Provides centralized package name resolution for all package types.
 * Ensures consistency between manifest and index.
 */
export class PackageNameService {
  /**
   * Resolve package name from naming context.
   * This is the single source of truth for all package name generation.
   * 
   * @param context - Naming context
   * @returns Resolved package name
   */
  static resolvePackageName(context: PackageNamingContext): string {
    // Validate context first
    validateNamingContext(context);
    
    logger.debug('Resolving package name', {
      contextSummary: summarizeNamingContext(context)
    });
    
    // Use Git path as the primary naming source
    // For GitHub repos, this will generate scoped names like:
    // - gh@username/repo (root package)
    // - gh@username/repo/path (subdirectory package)
    // - gh@username/repo/plugins/ui-design (plugin)
    // - gh@username/repo/plugins/ui-design/skills/mobile-ios-design (skill)
    
    const resolvedName = generateGitHubPackageName({
      gitUrl: context.git.url,
      path: context.git.path,
      packageName: context.metadata.name,
      repoPath: context.physical.repoRoot
    });
    
    logger.debug('Resolved package name', {
      input: {
        gitUrl: context.git.url,
        gitPath: context.git.path,
        metadataName: context.metadata.name,
        type: context.type
      },
      output: resolvedName
    });
    
    return resolvedName;
  }
  
  /**
   * Build manifest entry for openpackage.yml
   * 
   * @param context - Naming context
   * @param version - Package version
   * @param isDev - Whether this is a dev dependency
   * @returns Manifest entry structure
   */
  static buildManifestEntry(
    context: PackageNamingContext,
    version: string,
    isDev: boolean = false
  ): ManifestEntry {
    const name = this.resolvePackageName(context);
    
    const entry: ManifestEntry = {
      name,
      version,
      gitUrl: context.git.url,
      gitRef: context.git.ref,
      gitPath: context.git.path
    };
    
    logger.debug('Built manifest entry', {
      name,
      gitUrl: entry.gitUrl,
      gitPath: entry.gitPath,
      isDev
    });
    
    return entry;
  }
  
  /**
   * Build index entry for openpackage.index.yml
   * 
   * @param context - Naming context
   * @param version - Package version
   * @param physicalPath - Physical path to package (for index tracking)
   * @returns Index entry structure
   */
  static buildIndexEntry(
    context: PackageNamingContext,
    version: string,
    physicalPath: string
  ): IndexEntry {
    const packageName = this.resolvePackageName(context);
    
    const entry: IndexEntry = {
      packageName,
      version,
      path: physicalPath
    };
    
    // Add marketplace metadata if present
    if (context.marketplace) {
      entry.marketplace = {
        url: context.git.url,
        commitSha: context.marketplace.commitSha,
        pluginName: context.marketplace.pluginName || context.skill?.name || ''
      };
    }
    
    logger.debug('Built index entry', {
      packageName,
      version,
      path: physicalPath,
      hasMarketplace: !!context.marketplace
    });
    
    return entry;
  }
  
  /**
   * Validate that manifest and index names match.
   * Throws error if names diverge.
   * 
   * @param manifestName - Name from manifest
   * @param indexName - Name from index
   * @throws Error if names don't match
   */
  static validateNameConsistency(manifestName: string, indexName: string): void {
    if (manifestName !== indexName) {
      throw new Error(
        `Package name mismatch detected:\n` +
        `  Manifest: ${manifestName}\n` +
        `  Index:    ${indexName}\n` +
        `This indicates a bug in name resolution. Both should use PackageNameService.resolvePackageName().`
      );
    }
  }
  
  /**
   * Extract naming context from a loaded package and source.
   * Helper for integration with existing loader infrastructure.
   * 
   * @param source - Package source with Git override
   * @param loaded - Loaded package data
   * @returns Naming context
   */
  static extractContextFromSource(source: any, loaded: any): PackageNamingContext | null {
    // This is a helper method for gradual migration
    // It extracts context from existing data structures
    
    if (!source.gitSourceOverride && !source.gitUrl) {
      // No Git source, can't create context
      return null;
    }
    
    const gitUrl = source.gitSourceOverride?.gitUrl || source.gitUrl;
    const gitRef = source.gitSourceOverride?.gitRef || source.gitRef;
    const gitPath = source.gitSourceOverride?.gitPath || source.gitPath;
    
    // Determine type
    let type: 'plugin' | 'skill' | 'package' = 'package';
    if (loaded.pluginMetadata?.isSkill) {
      type = 'skill';
    } else if (loaded.pluginMetadata?.isPlugin) {
      type = 'plugin';
    }
    
    const context: PackageNamingContext = {
      type,
      git: {
        url: gitUrl,
        ref: gitRef,
        path: gitPath
      },
      physical: {
        contentRoot: loaded.contentRoot || source.localPath || ''
      },
      metadata: {
        name: loaded.metadata?.name,
        version: loaded.version
      }
    };
    
    // Add skill info if present
    if (type === 'skill' && source.pluginMetadata?.skillMetadata) {
      const skill = source.pluginMetadata.skillMetadata.skill;
      context.skill = {
        name: skill.name,
        parentPath: skill.skillPath.includes('/') 
          ? skill.skillPath.substring(0, skill.skillPath.lastIndexOf('/'))
          : '',
        relativePath: skill.skillPath
      };
    }
    
    try {
      validateNamingContext(context);
      return context;
    } catch (error) {
      logger.warn('Failed to extract valid naming context from source', {
        error: error instanceof Error ? error.message : String(error),
        source: {
          type: source.type,
          hasGitOverride: !!source.gitSourceOverride,
          hasPluginMetadata: !!source.pluginMetadata
        }
      });
      return null;
    }
  }
}
