/**
 * Skills Detector Module
 * 
 * Detects and manages skills within a skills collection.
 * A skill is identified by a SKILL.md file and contains focused functionality
 * that can be installed independently from the parent collection.
 */

import { join, dirname, basename, relative } from 'path';
import { exists, isDirectory, readTextFile } from '../../utils/fs.js';
import { walkFiles } from '../../utils/file-walker.js';
import { splitFrontmatter } from '../../utils/markdown-frontmatter.js';
import { logger } from '../../utils/logger.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { isJunk } from 'junk';

/**
 * Types of collections that can contain skills
 */
export type SkillCollectionType = 'plugin' | 'package' | 'repository';

/**
 * Comprehensive result of skills detection in a directory
 */
export interface SkillsDetectionResult {
  /**
   * Whether the collection contains any skills
   */
  hasSkills: boolean;
  
  /**
   * Types of collection detected (can be multiple: e.g., both plugin and package)
   */
  collectionTypes: SkillCollectionType[];
  
  /**
   * All discovered skills with their metadata
   */
  discoveredSkills: DiscoveredSkill[];
}

/**
 * Detailed information about a single discovered skill
 */
export interface DiscoveredSkill {
  /**
   * Skill name (from frontmatter or directory fallback)
   */
  name: string;
  
  /**
   * Skill version (from frontmatter, may be undefined)
   */
  version?: string;
  
  /**
   * Relative path to skill directory (parent of SKILL.md)
   */
  skillPath: string;
  
  /**
   * Relative path to SKILL.md file itself
   */
  manifestPath: string;
  
  /**
   * Parent directory name (used as fallback name)
   */
  directoryName: string;
  
  /**
   * Parsed frontmatter object from SKILL.md
   */
  frontmatter: SkillMetadata;
}

/**
 * Typed structure for SKILL.md frontmatter
 */
export interface SkillMetadata {
  name?: string;
  version?: string;
  metadata?: {
    version?: string;
  };
  [key: string]: any;  // Allow additional fields
}

/**
 * Check if a directory is a single skill (SKILL.md at root).
 * Used by loaders to identify skill packages.
 * 
 * @param dirPath - Absolute path to directory to check
 * @returns True if directory contains SKILL.md at root
 */
export async function isSingleSkillDirectory(dirPath: string): Promise<boolean> {
  const skillMdPath = join(dirPath, FILE_PATTERNS.SKILL_MD);
  return await exists(skillMdPath);
}

/**
 * Load skill metadata from a single skill directory (SKILL.md at root).
 * Used during package loading for single skill directories.
 * 
 * @param dirPath - Absolute path to skill directory
 * @returns Discovered skill metadata
 * @throws Error if SKILL.md not found at root
 */
export async function loadSingleSkill(dirPath: string): Promise<DiscoveredSkill> {
  const skillMdPath = join(dirPath, FILE_PATTERNS.SKILL_MD);
  
  if (!(await exists(skillMdPath))) {
    throw new Error(`Not a skill directory - ${FILE_PATTERNS.SKILL_MD} not found at root`);
  }
  
  const content = await readTextFile(skillMdPath);
  const { frontmatter } = splitFrontmatter(content);
  
  const directoryName = basename(dirPath);
  const name = frontmatter.name || directoryName;
  
  // Extract version with precedence rules
  let version: string | undefined;
  if (frontmatter.version) {
    version = String(frontmatter.version);
  } else if (frontmatter.metadata?.version) {
    version = String(frontmatter.metadata.version);
  }
  
  logger.debug('Loaded single skill', {
    dirPath,
    name,
    version,
    directoryName
  });
  
  return {
    name,
    version,
    skillPath: '.',  // Root of skill directory
    manifestPath: FILE_PATTERNS.SKILL_MD,
    directoryName,
    frontmatter: frontmatter as SkillMetadata
  };
}

/**
 * Detect if a directory contains skills and gather all skill metadata.
 * 
 * A skills collection must have:
 * 1. A root skills/ directory
 * 2. At least one SKILL.md file under skills/ (at any nesting depth)
 * 
 * @param dirPath - Absolute path to directory to check
 * @returns Complete detection result with all discovered skills
 */
export async function detectSkillsInDirectory(dirPath: string): Promise<SkillsDetectionResult> {
  logger.debug('Detecting skills in directory', { dirPath });
  
  const skillsDir = join(dirPath, 'skills');
  
  // Check if skills/ directory exists
  if (!await exists(skillsDir)) {
    logger.debug('No skills/ directory found', { dirPath });
    return {
      hasSkills: false,
      collectionTypes: [],
      discoveredSkills: []
    };
  }
  
  if (!await isDirectory(skillsDir)) {
    logger.debug('skills/ exists but is not a directory', { dirPath });
    return {
      hasSkills: false,
      collectionTypes: [],
      discoveredSkills: []
    };
  }
  
  // Discover all SKILL.md files
  const discoveredSkills: DiscoveredSkill[] = [];
  
  try {
    for await (const filePath of walkFiles(skillsDir, {
      filter: (path, isDir) => {
        // Skip junk files and directories
        const name = basename(path);
        if (isJunk(name)) {
          return false;
        }
        // Include all directories for traversal
        if (isDir) {
          return true;
        }
        // Include only SKILL.md files
        return name === FILE_PATTERNS.SKILL_MD;
      }
    })) {
      try {
        // Parse the SKILL.md file
        const frontmatter = await parseSkillFrontmatter(filePath);
        
        // Get the parent directory of SKILL.md (this is the skill directory)
        const skillDir = dirname(filePath);
        const directoryName = basename(skillDir);
        
        // Compute relative paths from dirPath
        const manifestPath = relative(dirPath, filePath);
        const skillPath = relative(dirPath, skillDir);
        
        // Extract name and version
        const name = extractSkillName(frontmatter, directoryName);
        const version = extractSkillVersion(frontmatter);
        
        const skill: DiscoveredSkill = {
          name,
          version,
          skillPath,
          manifestPath,
          directoryName,
          frontmatter
        };
        
        discoveredSkills.push(skill);
        logger.debug('DEBUG: Discovered skill', { 
          name, 
          version,
          skillPath,
          manifestPath,
          dirPath,
          skillDir
        });
      } catch (error) {
        logger.warn('Failed to process SKILL.md file', { 
          filePath, 
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue with other skills
      }
    }
  } catch (error) {
    logger.error('Error walking skills directory', { 
      skillsDir, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  // Check if we found any skills
  if (discoveredSkills.length === 0) {
    logger.debug('No SKILL.md files found in skills/', { dirPath });
    return {
      hasSkills: false,
      collectionTypes: [],
      discoveredSkills: []
    };
  }
  
  // Determine collection types
  const collectionTypes = await determineCollectionTypes(dirPath);
  
  logger.info('Skills detection complete', {
    dirPath,
    skillCount: discoveredSkills.length,
    collectionTypes
  });
  
  return {
    hasSkills: true,
    collectionTypes,
    discoveredSkills
  };
}

/**
 * Quick check if directory is a skills collection.
 * 
 * @param dirPath - Absolute path to directory to check
 * @returns True if directory contains skills
 */
export async function isSkillsCollection(dirPath: string): Promise<boolean> {
  const result = await detectSkillsInDirectory(dirPath);
  return result.hasSkills;
}

/**
 * Locate a skill by name with fallback to directory name.
 * 
 * Matching is case-insensitive and tries:
 * 1. Exact match on skill.name (frontmatter name)
 * 2. Exact match on skill.directoryName (directory name)
 * 
 * @param skills - Array of discovered skills
 * @param searchName - Name to search for
 * @returns Matching skill or null if not found
 */
export function findSkillByName(
  skills: DiscoveredSkill[],
  searchName: string
): DiscoveredSkill | null {
  const normalizedSearch = searchName.trim().toLowerCase();
  
  // First pass: exact match on frontmatter name
  for (const skill of skills) {
    if (skill.name.toLowerCase() === normalizedSearch) {
      return skill;
    }
  }
  
  // Second pass: exact match on directory name
  for (const skill of skills) {
    if (skill.directoryName.toLowerCase() === normalizedSearch) {
      return skill;
    }
  }
  
  return null;
}

/**
 * Validate that all requested skills exist in the collection.
 * 
 * @param skills - Array of discovered skills
 * @param requestedNames - Names of skills to validate
 * @returns Object with valid skills array and invalid names array
 */
export function validateSkillExists(
  skills: DiscoveredSkill[],
  requestedNames: string[]
): { valid: DiscoveredSkill[]; invalid: string[] } {
  const valid: DiscoveredSkill[] = [];
  const invalid: string[] = [];
  
  for (const name of requestedNames) {
    const skill = findSkillByName(skills, name);
    if (skill) {
      valid.push(skill);
    } else {
      invalid.push(name);
    }
  }
  
  return { valid, invalid };
}

/**
 * Parse SKILL.md frontmatter with error handling.
 * 
 * @param manifestPath - Absolute path to SKILL.md file
 * @returns Parsed skill metadata (empty object on error)
 */
async function parseSkillFrontmatter(manifestPath: string): Promise<SkillMetadata> {
  try {
    const content = await readTextFile(manifestPath);
    const { frontmatter } = splitFrontmatter<SkillMetadata>(content);
    return frontmatter || {};
  } catch (error) {
    logger.warn('Failed to parse SKILL.md frontmatter', { 
      manifestPath,
      error: error instanceof Error ? error.message : String(error)
    });
    return {};
  }
}

/**
 * Determine skill name with fallback logic.
 * 
 * Precedence:
 * 1. frontmatter.name (if present and non-empty)
 * 2. directoryName (fallback)
 * 
 * @param frontmatter - Parsed frontmatter from SKILL.md
 * @param directoryName - Parent directory name
 * @returns Skill name
 */
function extractSkillName(frontmatter: SkillMetadata, directoryName: string): string {
  if (frontmatter.name && frontmatter.name.trim().length > 0) {
    return frontmatter.name.trim();
  }
  
  logger.info('Using directory name as skill name (no frontmatter name)', { directoryName });
  return directoryName;
}

/**
 * Determine skill version with precedence rules.
 * 
 * Precedence:
 * 1. frontmatter.version
 * 2. frontmatter.metadata.version
 * 3. undefined (let transformer decide default)
 * 
 * @param frontmatter - Parsed frontmatter from SKILL.md
 * @returns Skill version or undefined
 */
function extractSkillVersion(frontmatter: SkillMetadata): string | undefined {
  if (frontmatter.version) {
    return frontmatter.version;
  }
  
  if (frontmatter.metadata?.version) {
    return frontmatter.metadata.version;
  }
  
  return undefined;
}

/**
 * Determine collection types based on presence of specific files.
 * 
 * Checks for:
 * - Plugin: .claude-plugin/plugin.json
 * - Package: openpackage.yml
 * - Repository: neither of the above (default)
 * 
 * @param dirPath - Absolute path to directory
 * @returns Array of detected collection types
 */
async function determineCollectionTypes(dirPath: string): Promise<SkillCollectionType[]> {
  const types: SkillCollectionType[] = [];
  
  // Check for plugin
  const pluginManifest = join(dirPath, '.claude-plugin', 'plugin.json');
  if (await exists(pluginManifest)) {
    types.push('plugin');
  }
  
  // Check for package
  const packageManifest = join(dirPath, 'openpackage.yml');
  if (await exists(packageManifest)) {
    types.push('package');
  }
  
  // Default to repository if neither
  if (types.length === 0) {
    types.push('repository');
  }
  
  return types;
}
