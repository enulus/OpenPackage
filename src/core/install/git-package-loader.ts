import { cloneRepoToCache } from '../../utils/git-clone.js';
import { loadPackageFromPath } from './path-package-loader.js';
import { detectPluginType } from './plugin-detector.js';
import { detectContentInDirectory, type ContentDiscoveryResult } from './content-detector.js';
import { isSingleContentDirectory } from './content-detector.js';
import type { ContentType } from './content-type-registry.js';
import { logger } from '../../utils/logger.js';
import type { Package } from '../../types/index.js';

export interface GitPackageLoadOptions {
  url: string;
  ref?: string;
  path?: string;
  contentFilter?: string;
  contentType?: ContentType;
  skillMetadata?: {
    name: string;
    skillPath: string;
  };
}

export interface GitPackageLoadResult {
  pkg: Package | null;
  sourcePath: string;
  repoPath: string;
  commitSha: string;
  isMarketplace: boolean;
  /**
   * Is this a content collection (skills/, agents/ directory without openpackage.yml)?
   */
  isContentCollection?: boolean;
  /**
   * Content type if this is a content collection
   */
  contentType?: ContentType;
  /**
   * Content detection result (available for both marketplace and non-marketplace sources)
   */
  contentDetection?: ContentDiscoveryResult;
}

export async function loadPackageFromGit(options: GitPackageLoadOptions): Promise<GitPackageLoadResult> {
  // Import content path parser
  const { parseContentPath } = await import('./content-path-parser.js');
  
  // CRITICAL: When gitPath points to a content directory, we must clone to the PARENT
  // directory, not the content itself (content items don't have openpackage.yml/plugin.json)
  let clonePath = options.path;
  let contentFilter = options.contentFilter;
  let contentType = options.contentType;
  
  if (options.path) {
    const contentInfo = parseContentPath(options.path);
    if (contentInfo.isContent) {
      // Path points to content - ALWAYS adjust clone path and filter
      clonePath = contentInfo.parentPath; // Clone to parent (plugin directory)
      contentFilter = contentInfo.contentRelativePath; // Filter to content subdirectory
      contentType = contentInfo.contentType;
      
      logger.debug('Detected content in git path, adjusting clone target', {
        originalPath: options.path,
        clonePath: clonePath || '(root)',
        contentFilter,
        contentType,
        contentFilterAlreadySet: !!options.contentFilter
      });
    }
  }
  
  const cloneResult = await cloneRepoToCache({ 
    url: options.url, 
    ref: options.ref,
    subdir: clonePath
  });
  
  const { path: sourcePath, repoPath, commitSha } = cloneResult;
  
  // Check if this is a marketplace first - marketplaces don't have openpackage.yml
  // and need to be handled differently
  const pluginDetection = await detectPluginType(sourcePath);
  if (pluginDetection.isPlugin && pluginDetection.type === 'marketplace') {
    // Detect skills in marketplace source (for backward compatibility)
    let contentDetection: ContentDiscoveryResult | undefined;
    try {
      contentDetection = await detectContentInDirectory(sourcePath, 'skills');
      if (contentDetection.hasContent) {
        logger.info('Skills detected in marketplace', {
          itemCount: contentDetection.discoveredItems.length,
          sourcePath
        });
      }
    } catch (error) {
      logger.warn('Failed to detect skills in marketplace', {
        sourcePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    return { 
      pkg: null, 
      sourcePath, 
      repoPath,
      commitSha,
      isMarketplace: true,
      contentDetection
    };
  }
  
  // Check if this is a single content item (only if no content filter specified)
  // If content filter is specified, we're loading from a parent directory
  if (!options.contentFilter) {
    // Try skills first (most common)
    const isSkill = await isSingleContentDirectory(sourcePath, 'skills');
    
    if (isSkill) {
      logger.info('Detected single skill from git source');
      // Let loadPackageFromPath handle the skill loading
      const pkg = await loadPackageFromPath(sourcePath, {
        gitUrl: options.url,
        path: options.path,
        repoPath
      });
      
      return { 
        pkg, 
        sourcePath, 
        repoPath,
        commitSha,
        isMarketplace: false,
        isContentCollection: false,
        contentDetection: undefined
      };
    }
    
    // Try agents
    const isAgent = await isSingleContentDirectory(sourcePath, 'agents');
    if (isAgent) {
      logger.info('Detected single agent from git source');
      const pkg = await loadPackageFromPath(sourcePath, {
        gitUrl: options.url,
        path: options.path,
        repoPath
      });
      
      return { 
        pkg, 
        sourcePath, 
        repoPath,
        commitSha,
        isMarketplace: false,
        isContentCollection: false,
        contentDetection: undefined
      };
    }
  }
  
  // Detect content in non-marketplace source
  // Try both skills and agents
  let contentDetection: ContentDiscoveryResult | undefined;
  const contentTypesToCheck: ContentType[] = ['skills', 'agents'];
  
  for (const type of contentTypesToCheck) {
    try {
      const detection = await detectContentInDirectory(sourcePath, type);
      if (detection.hasContent) {
        contentDetection = detection;
        logger.info(`${type} detected in source`, {
          itemCount: detection.discoveredItems.length,
          collectionTypes: detection.collectionTypes,
          sourcePath
        });
        break; // Use the first content type found
      }
    } catch (error) {
      logger.warn(`Failed to detect ${type} in source`, {
        sourcePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Check if this is a content collection (content/ without openpackage.yml and not a plugin)
  const hasOpenPackageYml = await import('../../utils/fs.js').then(m => 
    m.exists(sourcePath + '/openpackage.yml')
  );
  
  if (contentDetection?.hasContent && !hasOpenPackageYml && !pluginDetection.isPlugin) {
    logger.info(`Detected ${contentDetection.contentType} collection from git source`, {
      itemCount: contentDetection.discoveredItems.length
    });
    
    return {
      pkg: null,  // No single package
      sourcePath,
      repoPath,
      commitSha,
      isMarketplace: false,
      isContentCollection: true,
      contentType: contentDetection.contentType,
      contentDetection
    };
  }
  
  // Not a marketplace or content collection, load as regular package
  // Pass through content filter (either from options or auto-detected from path)
  const pkg = await loadPackageFromPath(sourcePath, {
    gitUrl: options.url,
    path: options.path,
    repoPath,
    contentFilter: contentFilter,  // Use adjusted contentFilter
    contentType,
    skillMetadata: options.skillMetadata
  });
  
  return { 
    pkg, 
    sourcePath, 
    repoPath,
    commitSha,
    isMarketplace: false,
    isContentCollection: false,
    contentDetection
  };
}
