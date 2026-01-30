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
      // Pass through content filter if specified
      const result = await loadPackageFromGit({
        url: source.gitUrl,
        ref: source.gitRef,
        path: source.gitPath,
        contentFilter: source.contentFilter,
        contentType: source.contentType,
        skillMetadata: source.pluginMetadata?.skillMetadata ? {
          name: source.pluginMetadata.skillMetadata.skill.name,
          skillPath: source.pluginMetadata.skillMetadata.skill.skillPath
        } : source.pluginMetadata?.contentMetadata ? {
          name: source.pluginMetadata.contentMetadata.item.name,
          skillPath: source.pluginMetadata.contentMetadata.item.itemPath
        } : undefined
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
            repoPath: result.repoPath,
            commitSha: result.commitSha,
            contentDetection: result.contentDetection,
            // Legacy
            skillsDetection: result.contentDetection?.contentType === 'skills' ? result.contentDetection as any : undefined
          }
        };
      }
      
      // Check if content collection (skills, agents, etc.)
      if (result.isContentCollection) {
        return {
          metadata: null as any, // Content collection doesn't have single package
          packageName: '', // Unknown until item selection
          version: '0.0.0',
          contentRoot: result.sourcePath,
          contentType: result.contentType,
          source: 'git',
          pluginMetadata: {
            isPlugin: false,
            isContentCollection: true,
            contentType: result.contentType,
            // Legacy for backward compatibility
            isSkillsCollection: result.contentType === 'skills'
          },
          sourceMetadata: {
            repoPath: result.repoPath,
            commitSha: result.commitSha,
            contentDetection: result.contentDetection,
            // Legacy
            skillsDetection: result.contentType === 'skills' ? result.contentDetection as any : undefined
          }
        };
      }
      
      // Load individual package/plugin/skill
      // result.pkg is already loaded by git-package-loader
      if (!result.pkg) {
        throw new Error('Failed to load package from git source');
      }
      
      // Detect plugin type
      const pluginDetection = await detectPluginType(result.sourcePath);
      
      const packageName = result.pkg.metadata.name;
      const version = result.pkg.metadata.version || '0.0.0';
      
      // Check if this is a single content item based on source metadata
      const isSingleContent = source.contentFilter !== undefined || source.contentType !== undefined;
      
      // Note: Plugin transformation is handled by loadPackageFromPath
      // Content items are now handled via filtering, not transformation
      return {
        metadata: result.pkg.metadata,
        packageName,
        version,
        contentRoot: result.sourcePath,
        source: 'git',
        pluginMetadata: pluginDetection.isPlugin ? {
          isPlugin: true,
          pluginType: pluginDetection.type as any,
          manifestPath: pluginDetection.manifestPath
        } : isSingleContent ? {
          isPlugin: false,
          isSingleContent: true,
          contentType: source.contentType,
          contentMetadata: source.pluginMetadata?.contentMetadata,
          // Legacy
          isSkill: source.contentType === 'skills',
          skillMetadata: source.pluginMetadata?.skillMetadata
        } : undefined,
        sourceMetadata: {
          repoPath: result.repoPath,
          commitSha: result.commitSha,
          contentDetection: result.contentDetection
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
  
  getDisplayName(source: PackageSource): string {
    const ref = source.gitRef ? `#${source.gitRef}` : '';
    const subdir = source.gitPath ? `&path=${source.gitPath}` : '';
    return source.packageName
      ? `${source.packageName} (git:${source.gitUrl}${ref}${subdir})`
      : `git:${source.gitUrl}${ref}${subdir}`;
  }
}
