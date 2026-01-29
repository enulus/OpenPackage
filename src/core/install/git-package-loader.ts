import { cloneRepoToCache } from '../../utils/git-clone.js';
import { loadPackageFromPath } from './path-package-loader.js';
import { detectPluginType } from './plugin-detector.js';
import { detectSkillsInDirectory, type SkillsDetectionResult } from './skills-detector.js';
import { logger } from '../../utils/logger.js';
import type { Package } from '../../types/index.js';

export interface GitPackageLoadOptions {
  url: string;
  ref?: string;
  path?: string;
  skillFilter?: string;
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
   * Is this a skills collection (skills/ directory without openpackage.yml)?
   */
  isSkillsCollection?: boolean;
  /**
   * Skills detection result (available for both marketplace and non-marketplace sources)
   */
  skillsDetection?: SkillsDetectionResult;
}

export async function loadPackageFromGit(options: GitPackageLoadOptions): Promise<GitPackageLoadResult> {
  const cloneResult = await cloneRepoToCache({ 
    url: options.url, 
    ref: options.ref,
    subdir: options.path
  });
  
  const { path: sourcePath, repoPath, commitSha } = cloneResult;
  
  // Check if this is a marketplace first - marketplaces don't have openpackage.yml
  // and need to be handled differently
  const pluginDetection = await detectPluginType(sourcePath);
  if (pluginDetection.isPlugin && pluginDetection.type === 'marketplace') {
    // Detect skills in marketplace source
    let skillsDetection: SkillsDetectionResult | undefined;
    try {
      skillsDetection = await detectSkillsInDirectory(sourcePath);
      if (skillsDetection.hasSkills) {
        logger.info('Skills detected in marketplace', {
          skillCount: skillsDetection.discoveredSkills.length,
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
      skillsDetection
    };
  }
  
  // Check if this is a single skill (only if no skill filter specified)
  // If skill filter is specified, we're loading from a parent directory
  if (!options.skillFilter) {
    const { isSingleSkillDirectory } = await import('./skills-detector.js');
    const isSkill = await isSingleSkillDirectory(sourcePath);
    
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
        isSkillsCollection: false,
        skillsDetection: undefined
      };
    }
  }
  
  // Detect skills in non-marketplace source
  let skillsDetection: SkillsDetectionResult | undefined;
  try {
    skillsDetection = await detectSkillsInDirectory(sourcePath);
    if (skillsDetection.hasSkills) {
      logger.info('Skills detected in source', {
        skillCount: skillsDetection.discoveredSkills.length,
        collectionTypes: skillsDetection.collectionTypes,
        sourcePath
      });
    }
  } catch (error) {
    logger.warn('Failed to detect skills in source', {
      sourcePath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  // Check if this is a skills collection (skills/ without openpackage.yml and not a plugin)
  const hasOpenPackageYml = await import('../../utils/fs.js').then(m => 
    m.exists(sourcePath + '/openpackage.yml')
  );
  
  if (skillsDetection?.hasSkills && !hasOpenPackageYml && !pluginDetection.isPlugin) {
    logger.info('Detected skills collection from git source', {
      skillCount: skillsDetection.discoveredSkills.length
    });
    
    return {
      pkg: null,  // No single package
      sourcePath,
      repoPath,
      commitSha,
      isMarketplace: false,
      isSkillsCollection: true,
      skillsDetection
    };
  }
  
  // Not a marketplace or skills collection, load as regular package
  // Pass through skill filter if specified
  const pkg = await loadPackageFromPath(sourcePath, {
    gitUrl: options.url,
    path: options.path,
    repoPath,
    skillFilter: options.skillFilter,
    skillMetadata: options.skillMetadata
  });
  
  return { 
    pkg, 
    sourcePath, 
    repoPath,
    commitSha,
    isMarketplace: false,
    isSkillsCollection: false,
    skillsDetection
  };
}
