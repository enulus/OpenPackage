import type { PackageSourceLoader, LoadedPackage } from './base.js';
import type { PackageSource } from '../unified/context.js';
import type { InstallOptions } from '../../../types/index.js';
import { SourceLoadError } from './base.js';
import { loadPackageFromGit } from '../git-package-loader.js';
import { detectPluginType } from '../plugin-detector.js';
import { detectBase } from '../base-detector.js';
import { getPlatformsState } from '../../../core/platforms.js';
import { logger } from '../../../utils/logger.js';
import { resolve, relative } from 'path';

/**
 * Loads packages from git repositories
 */
export class GitSourceLoader implements PackageSourceLoader {
  canHandle(source: PackageSource): boolean {
    return source.type === 'git';
  }
  
  async load(
    source: PackageSource,
    options: InstallOptions,
    cwd: string
  ): Promise<LoadedPackage> {
    if (!source.gitUrl) {
      throw new SourceLoadError(source, 'Git URL is required for git sources');
    }
    
    try {
      // Load package from git
      const result = await loadPackageFromGit({
        url: source.gitUrl,
        ref: source.gitRef,
        path: source.gitPath
      });
      
      // Phase 5: If manifest base is present, skip detection (reproducibility)
      let detectedBaseInfo: any = null;
      if (source.manifestBase) {
        // Use base from manifest instead of detecting
        const absoluteBase = resolve(result.repoPath, source.manifestBase);
        detectedBaseInfo = {
          matchType: 'manifest',
          base: absoluteBase,
          baseRelative: source.manifestBase,
          matchedPattern: null
        };
        
        source.detectedBase = absoluteBase;
        
        logger.info('Using base from manifest for git source', {
          base: source.manifestBase,
          absoluteBase
        });
      } else if (source.resourcePath || source.gitPath) {
        // NEW: If a resource path was specified, detect base
        const platformsState = getPlatformsState(cwd);
        const platformsConfig = platformsState.config;
        const pathToDetect = source.resourcePath || source.gitPath || '';
        
        logger.debug('Detecting base for git resource', {
          resourcePath: pathToDetect,
          repoPath: result.repoPath
        });
        
        detectedBaseInfo = await detectBase(
          pathToDetect,
          result.repoPath,
          platformsConfig
        );
        
        logger.info('Base detection result for git source', {
          matchType: detectedBaseInfo.matchType,
          base: detectedBaseInfo.base,
          matchedPattern: detectedBaseInfo.matchedPattern
        });
        
        // Store detected base in source
        if (detectedBaseInfo.base) {
          source.detectedBase = detectedBaseInfo.base;
        }
      }
      
      // Check if marketplace - return metadata, let command handle selection
      if (result.isMarketplace || detectedBaseInfo?.matchType === 'marketplace') {
        const pluginDetection = await detectPluginType(result.sourcePath);
        
        return {
          metadata: null as any, // Marketplace doesn't have single package
          packageName: '', // Unknown until plugin selection
          version: '0.0.0',
          contentRoot: result.sourcePath,
          source: 'git',
          pluginMetadata: {
            isPlugin: true,
            pluginType: 'marketplace',
            manifestPath: pluginDetection.manifestPath || detectedBaseInfo?.manifestPath
          },
          sourceMetadata: {
            repoPath: result.repoPath,
            commitSha: result.commitSha,
            baseDetection: detectedBaseInfo
          }
        };
      }
      
      // Use detected base as content root if available
      const contentRoot = detectedBaseInfo?.base || result.sourcePath;
      
      // Load individual package/plugin
      const { loadPackageFromPath } = await import('../path-package-loader.js');
      let sourcePackage = await loadPackageFromPath(contentRoot, {
        gitUrl: source.gitUrl,
        path: source.gitPath,
        repoPath: result.repoPath,
        marketplaceEntry: source.pluginMetadata?.marketplaceEntry
      });
      
      // Detect plugin type at content root
      const pluginDetection = await detectPluginType(contentRoot);
      
      const packageName = sourcePackage.metadata.name;
      const version = sourcePackage.metadata.version || '0.0.0';
      
      // Note: Plugin transformation is handled by the main flow, not here
      return {
        metadata: sourcePackage.metadata,
        packageName,
        version,
        contentRoot,
        source: 'git',
        pluginMetadata: pluginDetection.isPlugin ? {
          isPlugin: true,
          pluginType: pluginDetection.type as any,  // Can be 'individual', 'marketplace', or 'marketplace-defined'
          manifestPath: pluginDetection.manifestPath
        } : undefined,
        sourceMetadata: {
          repoPath: result.repoPath,
          commitSha: result.commitSha,
          baseDetection: detectedBaseInfo
        }
      };
    } catch (error) {
      if (error instanceof SourceLoadError) {
        throw error;
      }
      
      const ref = source.gitRef ? `#${source.gitRef}` : '';
      const subdir = source.gitPath ? ` (path: ${source.gitPath})` : '';
      throw new SourceLoadError(
        source,
        `Failed to load package from git: ${source.gitUrl}${ref}${subdir}`,
        error as Error
      );
    }
  }
  
}
