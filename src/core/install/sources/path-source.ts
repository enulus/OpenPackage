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
        skillFilter: source.skillFilter
      };
      
      if (source.gitSourceOverride) {
        loadContext.gitUrl = source.gitSourceOverride.gitUrl;
        loadContext.path = source.gitSourceOverride.gitPath;
      }
      
      // If skill filter is specified, extract skill metadata from pluginMetadata
      if (source.skillFilter && source.pluginMetadata?.skillMetadata) {
        loadContext.skillMetadata = {
          name: source.pluginMetadata.skillMetadata.skill.name,
          skillPath: source.pluginMetadata.skillMetadata.skill.skillPath
        };
      }
      
      // Pass through naming context if available (from skills-marketplace-handler)
      if ((source as any)._namingContext) {
        loadContext._namingContext = (source as any)._namingContext;
      }
      
      // Load package from path, passing git context for proper scoping
      let sourcePackage = await loadPackageFromPath(resolvedPath, loadContext);
      
      const packageName = sourcePackage.metadata.name;
      const version = sourcePackage.metadata.version || '0.0.0';
      
      // Check if this is a skill based on source metadata
      const isSkill = source.skillFilter !== undefined;
      
      // Note: Plugin transformation is handled by loadPackageFromPath
      // Skills are now handled via filtering, not transformation
      return {
        metadata: sourcePackage.metadata,
        packageName,
        version,
        contentRoot: resolvedPath,
        source: 'path',
        pluginMetadata: pluginDetection.isPlugin ? {
          isPlugin: true,
          pluginType: pluginDetection.type as any  // Can be 'individual', 'marketplace', or 'marketplace-defined'
        } : isSkill ? {
          isPlugin: false,
          isSkill: true,
          skillMetadata: source.pluginMetadata?.skillMetadata
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
