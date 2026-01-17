import type { PackageSourceLoader, LoadedPackage } from './base.js';
import type { PackageSource } from '../unified/context.js';
import type { InstallOptions } from '../../../types/index.js';
import { SourceLoadError } from './base.js';
import { loadPackageFromGit } from '../git-package-loader.js';
import { detectPluginType } from '../plugin-detector.js';

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
        subdirectory: source.gitSubdirectory
      });
      
      // Check if marketplace - return metadata, let command handle selection
      if (result.isMarketplace) {
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
            manifestPath: pluginDetection.manifestPath
          },
          sourceMetadata: {
            repoPath: result.repoPath
          }
        };
      }
      
      // Load individual package/plugin
      const { loadPackageFromPath } = await import('../path-package-loader.js');
      let sourcePackage = await loadPackageFromPath(result.sourcePath, {
        gitUrl: source.gitUrl,
        subdirectory: source.gitSubdirectory,
        repoPath: result.sourcePath
      });
      
      // Detect plugin type
      const pluginDetection = await detectPluginType(result.sourcePath);
      
      const packageName = sourcePackage.metadata.name;
      const version = sourcePackage.metadata.version || '0.0.0';
      
      // Note: Plugin transformation is handled by the main flow, not here
      return {
        metadata: sourcePackage.metadata,
        packageName,
        version,
        contentRoot: result.sourcePath,
        source: 'git',
        pluginMetadata: pluginDetection.isPlugin ? {
          isPlugin: true,
          pluginType: pluginDetection.type,
          manifestPath: pluginDetection.manifestPath
        } : undefined,
        sourceMetadata: {
          repoPath: result.repoPath
        }
      };
    } catch (error) {
      if (error instanceof SourceLoadError) {
        throw error;
      }
      
      const ref = source.gitRef ? `#${source.gitRef}` : '';
      const subdir = source.gitSubdirectory ? ` (subdirectory: ${source.gitSubdirectory})` : '';
      throw new SourceLoadError(
        source,
        `Failed to load package from git: ${source.gitUrl}${ref}${subdir}`,
        error as Error
      );
    }
  }
  
  getDisplayName(source: PackageSource): string {
    const ref = source.gitRef ? `#${source.gitRef}` : '';
    const subdir = source.gitSubdirectory ? `&subdirectory=${source.gitSubdirectory}` : '';
    return source.packageName
      ? `${source.packageName} (git:${source.gitUrl}${ref}${subdir})`
      : `git:${source.gitUrl}${ref}${subdir}`;
  }
}
