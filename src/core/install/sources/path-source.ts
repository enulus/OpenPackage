import { resolve, basename } from 'path';
import type { PackageSourceLoader, LoadedPackage } from './base.js';
import type { PackageSource } from '../unified/context.js';
import type { InstallOptions } from '../../../types/index.js';
import { SourceLoadError } from './base.js';
import { loadPackageFromPath } from '../path-package-loader.js';
import { detectPluginType } from '../plugin-detector.js';
import { detectBaseForFilepath } from '../base-detector.js';
import { getPlatformsState } from '../../../core/platforms.js';
import { logger } from '../../../utils/logger.js';
import { formatNoPatternMatchError } from '../../../utils/install-error-messages.js';

/**
 * Loads packages from local file paths (directories or tarballs)
 */
export class PathSourceLoader implements PackageSourceLoader {
  canHandle(source: PackageSource): boolean {
    return source.type === 'path';
  }
  
  async load(
    source: PackageSource,
    options: InstallOptions,
    cwd: string
  ): Promise<LoadedPackage> {
    if (!source.localPath) {
      throw new SourceLoadError(source, 'Local path is required for path sources');
    }
    
    try {
      const resolvedPath = resolve(cwd, source.localPath);
      
      // Phase 5: If manifest base is present, skip detection (reproducibility)
      let detectedBaseInfo: any = null;
      if (source.manifestBase) {
        // Use base from manifest instead of detecting
        // For path sources, manifestBase is relative to the path source itself
        const absoluteBase = resolve(resolvedPath, source.manifestBase);
        detectedBaseInfo = {
          matchType: 'manifest',
          base: absoluteBase,
          baseRelative: source.manifestBase,
          matchedPattern: null
        };
        
        source.detectedBase = absoluteBase;
        
        logger.info('Using base from manifest for path source', {
          base: source.manifestBase,
          absoluteBase
        });
      } else if (source.resourcePath) {
        // NEW: If a resource path was specified, detect base
        const platformsState = getPlatformsState(cwd);
        const platformsConfig = platformsState.config;
        
        logger.debug('Detecting base for path resource', {
          resourcePath: source.resourcePath,
          resolvedPath
        });
        
        detectedBaseInfo = await detectBaseForFilepath(
          resolvedPath,
          platformsConfig
        );
        
        logger.info('Base detection result for path source', {
          matchType: detectedBaseInfo.matchType,
          base: detectedBaseInfo.base,
          matchedPattern: detectedBaseInfo.matchedPattern
        });
        
        // Phase 6: Enhanced error message with pattern suggestions
        if (detectedBaseInfo.matchType === 'none') {
          const resourcePath = source.resourcePath || source.localPath || '';
          const errorMessage = formatNoPatternMatchError(resourcePath, platformsConfig);
          throw new SourceLoadError(source, errorMessage);
        }
        
        // Store detected base in source
        if (detectedBaseInfo.base) {
          source.detectedBase = detectedBaseInfo.base;
        }
      }
      
      // Use detected base as content root if available
      const contentRoot = detectedBaseInfo?.base || resolvedPath;
      
      // Detect if this is a Claude Code plugin
      const pluginDetection = await detectPluginType(contentRoot);
      
      // Check if marketplace
      if (detectedBaseInfo?.matchType === 'marketplace') {
        return {
          metadata: null as any,
          packageName: '',
          version: '0.0.0',
          contentRoot,
          source: 'path',
          pluginMetadata: {
            isPlugin: true,
            pluginType: 'marketplace',
            manifestPath: pluginDetection.manifestPath || detectedBaseInfo?.manifestPath
          },
          sourceMetadata: {
            baseDetection: detectedBaseInfo
          }
        };
      }
      
      // Build context for package loading
      // If gitSourceOverride exists, use it for proper git-based naming
      const loadContext: any = {
        repoPath: contentRoot,
        marketplaceEntry: source.pluginMetadata?.marketplaceEntry
      };
      
      if (source.gitSourceOverride) {
        loadContext.gitUrl = source.gitSourceOverride.gitUrl;
        loadContext.path = source.gitSourceOverride.gitPath;
      }
      
      // Load package from path, passing git context for proper scoping
      let sourcePackage = await loadPackageFromPath(contentRoot, loadContext);
      
      const packageName = sourcePackage.metadata.name;
      const version = sourcePackage.metadata.version || '0.0.0';
      
      // Note: Plugin transformation is handled by the main flow, not here
      return {
        metadata: sourcePackage.metadata,
        packageName,
        version,
        contentRoot,
        source: 'path',
        pluginMetadata: pluginDetection.isPlugin ? {
          isPlugin: true,
          pluginType: pluginDetection.type as any  // Can be 'individual', 'marketplace', or 'marketplace-defined'
        } : undefined,
        sourceMetadata: {
          baseDetection: detectedBaseInfo
        }
      };
    } catch (error) {
      throw new SourceLoadError(
        source,
        `Failed to load package from path: ${source.localPath}`,
        error as Error
      );
    }
  }
  
}
