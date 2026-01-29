import { generateGitHubPackageName, type GitHubPackageNamingContext } from './plugin-naming.js';
import { logger } from './logger.js';
import { ValidationError } from './errors.js';

/**
 * Package type for unified name resolution.
 * - 'plugin': Claude Code plugin
 * - 'skill': Individual skill (from plugin or standalone)
 * - 'package': Regular OpenPackage
 */
export type PackageType = 'plugin' | 'skill' | 'package';

/**
 * Context for unified package name resolution.
 * Provides all necessary information for any package type.
 */
export interface PackageNameResolutionContext {
  /** Type of package being resolved */
  type: PackageType;
  
  /**
   * Path within repository (relative to repo root)
   * 
   * IMPORTANT: For skills, this MUST include the full path including
   * the skill subdirectory. Example: "plugins/ui-design/skills/mobile-ios-design"
   * 
   * Do NOT append skillMetadata.skillPath to this value.
   * 
   * This is set by:
   * - Marketplace handler: gitSourceOverride.gitPath = combinedPath
   * - Path source loader: loadContext.path = source.gitSourceOverride.gitPath
   * - Plugin transformer: Uses context.path as-is
   */
  path?: string;
  
  /** Git URL (for extracting GitHub info) */
  gitUrl?: string;
  
  /** Path to repository root (for fallback) */
  repoPath?: string;
  
  /** Name from manifest (plugin.json or openpackage.yml) */
  packageName?: string;
  
  /** Skill metadata (only for type='skill') */
  skillMetadata?: {
    name: string;
    skillPath: string;
  };
}

/**
 * Validate that the path doesn't contain duplicate skill paths.
 * This catches bugs where skill paths are concatenated multiple times.
 * 
 * Example of invalid path: "plugins/ui-design/skills/mobile/skills/mobile"
 *                          (skills/mobile appears twice)
 */
function validateSkillPath(path: string | undefined): void {
  if (!path) return;
  
  // Check for any path that has /skills/ appearing twice
  // This catches patterns like:
  // - "skills/test/skills/test" (duplicate at start)
  // - "plugins/ui/skills/mobile/skills/mobile" (duplicate in middle)
  // - "collections/skills/abc/skills/abc" (duplicate anywhere)
  const skillsSegments = (path.match(/\/skills\//g) || []).length;
  const startsWithSkills = path.startsWith('skills/');
  const totalSkillsOccurrences = skillsSegments + (startsWithSkills ? 1 : 0);
  
  if (totalSkillsOccurrences > 1) {
    throw new ValidationError(
      `Duplicate skill path segment detected: ${path}\n` +
      `Path contains multiple /skills/ segments (found ${totalSkillsOccurrences}). ` +
      `For skill packages, context.path should already include the full path.\n` +
      `Do NOT append skillMetadata.skillPath to context.path.`
    );
  }
}

/**
 * Resolve package name from context.
 * 
 * This is the single source of truth for ALL package name resolution.
 * It handles plugins, skills, and regular packages uniformly.
 * 
 * Benefits:
 * - Single place to update naming logic
 * - Consistent behavior across all package types
 * - Clear validation and error messages
 * - Easy to test
 * 
 * @param context - Package resolution context
 * @returns Resolved package name
 * @throws ValidationError if path contains duplicate skill segments
 */
export function resolvePackageNameFromContext(
  context: PackageNameResolutionContext
): string {
  // Validate path before proceeding
  validateSkillPath(context.path);
  
  logger.debug('Resolving package name from context', {
    type: context.type,
    hasGitUrl: !!context.gitUrl,
    hasPath: !!context.path,
    hasPackageName: !!context.packageName,
    hasSkillMetadata: !!context.skillMetadata
  });
  
  // For skills, use the full path (already includes skill subdirectory)
  if (context.type === 'skill') {
    const skillName = generateGitHubPackageName({
      gitUrl: context.gitUrl,
      path: context.path,  // Don't modify - already complete
      packageName: context.skillMetadata?.name,
      repoPath: context.repoPath
    });
    
    logger.debug('Generated skill package name', {
      result: skillName,
      skillName: context.skillMetadata?.name,
      path: context.path
    });
    
    return skillName;
  }
  
  // For plugins, use their own logic
  if (context.type === 'plugin') {
    const pluginName = generateGitHubPackageName({
      gitUrl: context.gitUrl,
      path: context.path,
      packageName: context.packageName,
      repoPath: context.repoPath
    });
    
    logger.debug('Generated plugin package name', {
      result: pluginName,
      packageName: context.packageName,
      path: context.path
    });
    
    return pluginName;
  }
  
  // For regular packages, apply GitHub scoping if available
  if (context.type === 'package') {
    const packageNameResult = generateGitHubPackageName({
      gitUrl: context.gitUrl,
      path: context.path,
      packageName: context.packageName,
      repoPath: context.repoPath
    });
    
    logger.debug('Generated package name', {
      result: packageNameResult,
      packageName: context.packageName,
      path: context.path
    });
    
    return packageNameResult;
  }
  
  // Fallback (should not reach here due to TypeScript types)
  throw new ValidationError(
    `Unknown package type: ${(context as any).type}. ` +
    `Must be 'plugin', 'skill', or 'package'.`
  );
}

/**
 * Helper to create a skill resolution context.
 * Ensures all required fields are present for skill name resolution.
 */
export function createSkillResolutionContext(options: {
  gitUrl?: string;
  path?: string;
  skillName: string;
  skillPath: string;
  repoPath?: string;
}): PackageNameResolutionContext {
  return {
    type: 'skill',
    gitUrl: options.gitUrl,
    path: options.path,
    repoPath: options.repoPath,
    skillMetadata: {
      name: options.skillName,
      skillPath: options.skillPath
    }
  };
}

/**
 * Helper to create a plugin resolution context.
 * Ensures all required fields are present for plugin name resolution.
 */
export function createPluginResolutionContext(options: {
  gitUrl?: string;
  path?: string;
  packageName?: string;
  repoPath?: string;
}): PackageNameResolutionContext {
  return {
    type: 'plugin',
    gitUrl: options.gitUrl,
    path: options.path,
    packageName: options.packageName,
    repoPath: options.repoPath
  };
}

/**
 * Helper to create a package resolution context.
 * Ensures all required fields are present for package name resolution.
 */
export function createPackageResolutionContext(options: {
  gitUrl?: string;
  path?: string;
  packageName?: string;
  repoPath?: string;
}): PackageNameResolutionContext {
  return {
    type: 'package',
    gitUrl: options.gitUrl,
    path: options.path,
    packageName: options.packageName,
    repoPath: options.repoPath
  };
}
