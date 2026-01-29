/**
 * Naming Context Module
 * 
 * Provides a unified data structure for package name resolution.
 * Eliminates ambiguity between physical paths, Git paths, and metadata.
 */

/**
 * Package type enumeration
 */
export type PackageType = 'plugin' | 'skill' | 'package' | 'marketplace';

/**
 * Git source information (canonical source of truth for naming)
 */
export interface GitSource {
  /**
   * Git URL (e.g., https://github.com/user/repo.git)
   */
  url: string;
  
  /**
   * Git ref (branch, tag, or commit SHA)
   */
  ref?: string;
  
  /**
   * Complete path from repository root.
   * 
   * IMPORTANT: For skills, this MUST include the full path including
   * the skill subdirectory. 
   * 
   * Examples:
   * - Plugin: "plugins/ui-design"
   * - Skill: "plugins/ui-design/skills/mobile-ios-design"
   * - Package: "packages/utilities"
   * - Root: undefined (package is at repo root)
   */
  path?: string;
}

/**
 * Physical location information (where files actually exist on disk)
 */
export interface PhysicalLocation {
  /**
   * Absolute path to package content root
   */
  contentRoot: string;
  
  /**
   * Absolute path to repository root (if different from contentRoot)
   */
  repoRoot?: string;
}

/**
 * Package metadata from manifest files
 */
export interface PackageMetadata {
  /**
   * Package name from manifest (plugin.json, openpackage.yml, SKILL.md)
   */
  name?: string;
  
  /**
   * Package version
   */
  version?: string;
}

/**
 * Skill-specific information
 */
export interface SkillInfo {
  /**
   * Skill name (from SKILL.md frontmatter or directory)
   */
  name: string;
  
  /**
   * Path to parent container (plugin or package directory)
   * Example: "plugins/ui-design"
   */
  parentPath: string;
  
  /**
   * Path relative to parent
   * Example: "skills/mobile-ios-design"
   */
  relativePath: string;
}

/**
 * Marketplace-specific information
 */
export interface MarketplaceInfo {
  /**
   * Marketplace name
   */
  name: string;
  
  /**
   * Commit SHA of marketplace repository
   */
  commitSha: string;
  
  /**
   * Plugin name within marketplace (if applicable)
   */
  pluginName?: string;
}

/**
 * Unified naming context for package name resolution.
 * 
 * This is the single source of truth for all package identification.
 * All naming decisions should be made based on this context.
 */
export interface PackageNamingContext {
  /**
   * Package type
   */
  type: PackageType;
  
  /**
   * Git source information (primary naming source)
   */
  git: GitSource;
  
  /**
   * Physical location (for file operations, not naming)
   */
  physical: PhysicalLocation;
  
  /**
   * Package metadata from manifests
   */
  metadata: PackageMetadata;
  
  /**
   * Skill-specific information (only present for skills)
   */
  skill?: SkillInfo;
  
  /**
   * Marketplace-specific information (only present for marketplace sources)
   */
  marketplace?: MarketplaceInfo;
}

/**
 * Validate that a naming context is complete and consistent.
 * 
 * @param context - Naming context to validate
 * @throws Error if context is invalid
 */
export function validateNamingContext(context: PackageNamingContext): void {
  // Validate Git source
  if (!context.git.url) {
    throw new Error('Naming context missing Git URL');
  }
  
  // Validate skill-specific requirements
  if (context.type === 'skill') {
    if (!context.skill) {
      throw new Error('Skill context missing skill information');
    }
    
    if (!context.skill.name) {
      throw new Error('Skill context missing skill name');
    }
    
    if (!context.git.path) {
      throw new Error('Skill context missing Git path');
    }
    
    // Validate that git.path is the complete path (includes skill subdirectory)
    // It should end with the skill's relativePath
    if (!context.git.path.endsWith(context.skill.relativePath)) {
      throw new Error(
        `Skill Git path "${context.git.path}" must end with skill relative path "${context.skill.relativePath}". ` +
        `The git.path should be the COMPLETE path from repository root.`
      );
    }
    
    // Check for duplicate skill path segments
    const skillsSegments = (context.git.path.match(/\/skills\//g) || []).length;
    const startsWithSkills = context.git.path.startsWith('skills/');
    const totalSkillsOccurrences = skillsSegments + (startsWithSkills ? 1 : 0);
    
    if (totalSkillsOccurrences > 1) {
      throw new Error(
        `Duplicate skill path segment detected in "${context.git.path}". ` +
        `Found ${totalSkillsOccurrences} occurrences of "/skills/". ` +
        `The path should contain only one skills directory.`
      );
    }
  }
  
  // Validate marketplace-specific requirements
  if (context.marketplace && !context.marketplace.commitSha) {
    throw new Error('Marketplace context missing commit SHA');
  }
}

/**
 * Create a display-friendly summary of a naming context for logging/debugging.
 * 
 * @param context - Naming context to summarize
 * @returns Human-readable summary
 */
export function summarizeNamingContext(context: PackageNamingContext): string {
  const parts: string[] = [
    `type=${context.type}`,
    `git.url=${context.git.url}`,
  ];
  
  if (context.git.ref) {
    parts.push(`git.ref=${context.git.ref}`);
  }
  
  if (context.git.path) {
    parts.push(`git.path=${context.git.path}`);
  }
  
  if (context.metadata.name) {
    parts.push(`metadata.name=${context.metadata.name}`);
  }
  
  if (context.skill) {
    parts.push(`skill.name=${context.skill.name}`);
    parts.push(`skill.parentPath=${context.skill.parentPath}`);
    parts.push(`skill.relativePath=${context.skill.relativePath}`);
  }
  
  return `PackageNamingContext(${parts.join(', ')})`;
}
