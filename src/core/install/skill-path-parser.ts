/**
 * Skill Path Parser
 * 
 * Utilities for detecting and parsing skill paths from git paths.
 * Used during bulk installation to detect when a manifest dependency
 * points to a skill subdirectory.
 */

import { logger } from '../../utils/logger.js';

/**
 * Result of skill path detection
 */
export interface SkillPathInfo {
  /**
   * Whether this path points to a skill
   */
  isSkill: boolean;
  
  /**
   * Parent plugin/package path (e.g., "plugins/ui-design")
   */
  parentPath?: string;
  
  /**
   * Skill-relative path within parent (e.g., "skills/mobile-ios-design")
   */
  skillRelativePath?: string;
  
  /**
   * Skill name extracted from path (last segment)
   */
  skillName?: string;
  
  /**
   * Full git path (same as input if valid)
   */
  fullPath?: string;
}

/**
 * Detect if a git path points to a skill directory.
 * 
 * A skill path is identified by containing a "/skills/" segment.
 * 
 * Examples:
 * - "plugins/ui-design/skills/mobile-ios-design" → skill
 * - "skills/git" → skill (root-level skills)
 * - "plugins/ui-design" → not a skill
 * - "packages/example" → not a skill
 * 
 * @param gitPath - Git subdirectory path (from manifest "path" field)
 * @returns Skill path information
 */
export function parseSkillPath(gitPath: string | undefined): SkillPathInfo {
  if (!gitPath) {
    return { isSkill: false };
  }
  
  // Normalize path (remove leading/trailing slashes)
  const normalizedPath = gitPath.replace(/^\/+|\/+$/g, '');
  
  // Check if path contains "/skills/" segment OR starts with "skills/"
  const hasSkillsSegment = normalizedPath.includes('/skills/') || normalizedPath.startsWith('skills/');
  
  if (!hasSkillsSegment) {
    return { isSkill: false };
  }
  
  // Split on "/skills/" or "skills/" to separate parent and skill paths
  let skillsIndex: number;
  let parentPath: string;
  let skillRelativePath: string;
  
  if (normalizedPath.startsWith('skills/')) {
    // Root-level skill (no parent)
    skillsIndex = 0;
    parentPath = '';
    skillRelativePath = normalizedPath;
  } else {
    // Nested skill (has parent path)
    skillsIndex = normalizedPath.indexOf('/skills/');
    parentPath = normalizedPath.substring(0, skillsIndex);
    skillRelativePath = normalizedPath.substring(skillsIndex + 1); // Include "skills/"
  }
  
  // Extract skill name (last segment of path)
  const segments = normalizedPath.split('/');
  const skillName = segments[segments.length - 1];
  
  // Validate skill name is not empty
  if (!skillName) {
    logger.warn('Invalid skill path - missing skill name', { gitPath });
    return { isSkill: false };
  }
  
  logger.debug('Detected skill path', {
    gitPath,
    parentPath: parentPath || '(root)',
    skillRelativePath,
    skillName
  });
  
  return {
    isSkill: true,
    parentPath: parentPath || undefined, // Empty string → undefined for root-level skills
    skillRelativePath,
    skillName,
    fullPath: normalizedPath
  };
}

/**
 * Check if a path points to a skill (convenience function)
 * 
 * @param gitPath - Git subdirectory path
 * @returns True if path contains "/skills/" segment
 */
export function isSkillPath(gitPath: string | undefined): boolean {
  return parseSkillPath(gitPath).isSkill;
}

/**
 * Extract skill filter path for file discovery.
 * 
 * The skill filter is the path relative to the parent directory
 * that should be used to filter files during installation.
 * 
 * @param skillInfo - Parsed skill path info
 * @returns Skill filter path for discovery options, or undefined if not a skill
 */
export function getSkillFilterPath(skillInfo: SkillPathInfo): string | undefined {
  if (!skillInfo.isSkill || !skillInfo.skillRelativePath) {
    return undefined;
  }
  
  return skillInfo.skillRelativePath;
}
