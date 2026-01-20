import { resolve, basename } from 'path';
import type { PackageSourceLoader, LoadedPackage } from './base.js';
import type { PackageSource } from '../unified/context.js';
import type { InstallOptions } from '../../../types/index.js';
import { SourceLoadError } from './base.js';
import { loadPackageFromPath } from '../path-package-loader.js';
import { detectPluginType } from '../plugin-detector.js';

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
      
      // Detect if this is a Claude Code plugin
      const pluginDetection = await detectPluginType(resolvedPath);
      
      // Build context for package loading
      // If gitSourceOverride exists, use it for proper git-based naming
      const loadContext: any = {
        repoPath: resolvedPath,
        marketplaceEntry: source.pluginMetadata?.marketplaceEntry,
        marketplaceName: source.pluginMetadata?.marketplaceName
      };
      
      if (source.gitSourceOverride) {
        loadContext.gitUrl = source.gitSourceOverride.gitUrl;
        loadContext.subdirectory = source.gitSourceOverride.gitSubdirectory;
      }
      
      // Load package from path, passing git context for proper scoping
      let sourcePackage = await loadPackageFromPath(resolvedPath, loadContext);
      
      const packageName = sourcePackage.metadata.name;
      const version = sourcePackage.metadata.version || '0.0.0';
      
      // Note: Plugin transformation is handled by the main flow, not here
      return {
        metadata: sourcePackage.metadata,
        packageName,
        version,
        contentRoot: resolvedPath,
        source: 'path',
        pluginMetadata: pluginDetection.isPlugin ? {
          isPlugin: true,
          pluginType: pluginDetection.type as any  // Can be 'individual', 'marketplace', or 'marketplace-defined'
        } : undefined,
        sourceMetadata: {
          wasTarball: source.sourceType === 'tarball'
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
  
  getDisplayName(source: PackageSource): string {
    return source.packageName
      ? `${source.packageName} (from ${source.localPath})`
      : basename(source.localPath || '');
  }
}
