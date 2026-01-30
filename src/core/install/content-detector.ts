/**
 * Content Detector Module
 * 
 * Unified content detection for skills, agents, and future content types.
 * Supports both manifest-based (skills) and file-based (agents) discovery.
 */

import { join, dirname, basename, relative } from 'path';
import { exists, isDirectory, readTextFile } from '../../utils/fs.js';
import { walkFiles } from '../../utils/file-walker.js';
import { splitFrontmatter } from '../../utils/markdown-frontmatter.js';
import { logger } from '../../utils/logger.js';
import { isJunk } from 'junk';
import { promises as fs } from 'fs';
import {
  type ContentType,
  type ContentTypeDefinition,
  type ContentItem,
  type ContentDetectionResult,
  getContentTypeDefinition
} from './content-type-registry.js';

/**
 * Types of collections that can contain content
 */
export type ContentCollectionType = 'plugin' | 'package' | 'repository';

/**
 * Comprehensive result of content detection in a directory
 */
export interface ContentDiscoveryResult extends ContentDetectionResult {
  /**
   * Types of collection detected (can be multiple: e.g., both plugin and package)
   */
  collectionTypes: ContentCollectionType[];
}

/**
 * Check if a directory is a single content item (manifest at root).
 * Used by loaders to identify single-item packages.
 * 
 * @param dirPath - Absolute path to directory to check
 * @param contentType - Content type to check for
 * @returns True if directory contains content manifest at root
 */
export async function isSingleContentDirectory(
  dirPath: string,
  contentType: ContentType
): Promise<boolean> {
  const definition = getContentTypeDefinition(contentType);
  
  if (definition.discoveryStrategy === 'manifest-based' && definition.manifestFile) {
    const manifestPath = join(dirPath, definition.manifestFile);
    return await exists(manifestPath);
  } else if (definition.discoveryStrategy === 'file-based') {
    // For file-based, check if the directory itself is a single .md file or contains one at root
    // This is typically not used for agents, but included for completeness
    return false;
  }
  
  return false;
}

/**
 * Load content metadata from a single content directory (manifest at root).
 * Used during package loading for single content directories.
 * 
 * @param dirPath - Absolute path to content directory
 * @param contentType - Content type
 * @returns Discovered content metadata
 * @throws Error if manifest not found at root
 */
export async function loadSingleContent(
  dirPath: string,
  contentType: ContentType
): Promise<ContentItem> {
  const definition = getContentTypeDefinition(contentType);
  
  if (definition.discoveryStrategy !== 'manifest-based' || !definition.manifestFile) {
    throw new Error(`Content type '${contentType}' does not support single content loading`);
  }
  
  const manifestPath = join(dirPath, definition.manifestFile);
  
  if (!(await exists(manifestPath))) {
    throw new Error(
      `Not a ${definition.singularName} directory - ${definition.manifestFile} not found at root`
    );
  }
  
  const content = await readTextFile(manifestPath);
  const { frontmatter } = splitFrontmatter(content);
  
  const fallbackName = basename(dirPath);
  const name = frontmatter.name || fallbackName;
  
  // Extract version with precedence rules
  let version: string | undefined;
  if (frontmatter.version) {
    version = String(frontmatter.version);
  } else if (frontmatter.metadata?.version) {
    version = String(frontmatter.metadata.version);
  }
  
  logger.debug(`Loaded single ${definition.singularName}`, {
    dirPath,
    name,
    version,
    fallbackName
  });
  
  return {
    contentType,
    name,
    version,
    itemPath: '.', // Root of content directory
    manifestPath: definition.manifestFile,
    fallbackName,
    frontmatter: frontmatter as Record<string, any>
  };
}

/**
 * Detect if a directory contains content and gather all content metadata.
 * 
 * @param dirPath - Absolute path to directory to check
 * @param contentType - Content type to detect
 * @returns Complete detection result with all discovered content
 */
export async function detectContentInDirectory(
  dirPath: string,
  contentType: ContentType
): Promise<ContentDiscoveryResult> {
  logger.debug(`Detecting ${contentType} in directory`, { dirPath });
  
  const definition = getContentTypeDefinition(contentType);
  const contentDir = join(dirPath, definition.directoryPattern);
  
  // Check if content directory exists
  if (!(await exists(contentDir))) {
    logger.debug(`No ${definition.directoryPattern} directory found`, { dirPath });
    return {
      hasContent: false,
      contentType,
      discoveredItems: [],
      collectionTypes: []
    };
  }
  
  if (!(await isDirectory(contentDir))) {
    logger.debug(`${definition.directoryPattern} exists but is not a directory`, { dirPath });
    return {
      hasContent: false,
      contentType,
      discoveredItems: [],
      collectionTypes: []
    };
  }
  
  // Discover content based on strategy
  let discoveredItems: ContentItem[];
  
  if (definition.discoveryStrategy === 'manifest-based') {
    discoveredItems = await discoverManifestBasedContent(
      dirPath,
      contentDir,
      definition
    );
  } else if (definition.discoveryStrategy === 'file-based') {
    discoveredItems = await discoverFileBasedContent(
      dirPath,
      contentDir,
      definition
    );
  } else {
    throw new Error(`Unknown discovery strategy: ${definition.discoveryStrategy}`);
  }
  
  // Check if we found any content
  if (discoveredItems.length === 0) {
    logger.debug(`No ${definition.pluralName} found in ${definition.directoryPattern}`, { dirPath });
    return {
      hasContent: false,
      contentType,
      discoveredItems: [],
      collectionTypes: []
    };
  }
  
  // Determine collection types
  const collectionTypes = await determineCollectionTypes(dirPath);
  
  logger.info('Content detection complete', {
    dirPath,
    contentType,
    itemCount: discoveredItems.length,
    collectionTypes
  });
  
  return {
    hasContent: true,
    contentType,
    discoveredItems,
    collectionTypes
  };
}

/**
 * Discover content using manifest-based strategy (e.g., skills with SKILL.md)
 */
async function discoverManifestBasedContent(
  rootDir: string,
  contentDir: string,
  definition: ContentTypeDefinition
): Promise<ContentItem[]> {
  const discoveredItems: ContentItem[] = [];
  
  if (!definition.manifestFile) {
    throw new Error(`Manifest file not defined for ${definition.type}`);
  }
  
  try {
    for await (const filePath of walkFiles(contentDir, {
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
        // Include only manifest files
        return name === definition.manifestFile;
      }
    })) {
      try {
        // Parse the manifest file
        const content = await readTextFile(filePath);
        const { frontmatter } = splitFrontmatter(content);
        
        // Get the parent directory of manifest (this is the item directory)
        const itemDir = dirname(filePath);
        const fallbackName = basename(itemDir);
        
        // Compute relative paths from rootDir
        const manifestPath = relative(rootDir, filePath);
        const itemPath = relative(rootDir, itemDir);
        
        // Extract name and version
        const name = extractContentName(frontmatter, fallbackName);
        const version = extractContentVersion(frontmatter);
        
        const item: ContentItem = {
          contentType: definition.type,
          name,
          version,
          itemPath,
          manifestPath,
          fallbackName,
          frontmatter: frontmatter as Record<string, any>
        };
        
        discoveredItems.push(item);
        logger.debug(`Discovered ${definition.singularName}`, {
          name,
          version,
          itemPath,
          manifestPath
        });
      } catch (error) {
        logger.warn(`Failed to process ${definition.manifestFile} file`, {
          filePath,
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue with other items
      }
    }
  } catch (error) {
    logger.error(`Error walking ${definition.pluralName} directory`, {
      contentDir,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  return discoveredItems;
}

/**
 * Discover content using file-based strategy (e.g., agents as *.md files)
 */
async function discoverFileBasedContent(
  rootDir: string,
  contentDir: string,
  definition: ContentTypeDefinition
): Promise<ContentItem[]> {
  const discoveredItems: ContentItem[] = [];
  
  if (!definition.filePattern) {
    throw new Error(`File pattern not defined for ${definition.type}`);
  }
  
  try {
    // Read directory entries
    const entries = await fs.readdir(contentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip directories and junk files
      if (entry.isDirectory() || isJunk(entry.name)) {
        continue;
      }
      
      // Check if file matches pattern
      if (definition.filePattern === '*.md' && !entry.name.endsWith('.md')) {
        continue;
      }
      
      const filePath = join(contentDir, entry.name);
      
      try {
        // Parse the file
        const content = await readTextFile(filePath);
        const { frontmatter } = splitFrontmatter(content);
        
        // Extract fallback name (filename without extension)
        const fallbackName = entry.name.endsWith('.md')
          ? entry.name.slice(0, -3)
          : entry.name;
        
        // Compute relative paths from rootDir
        const itemPath = relative(rootDir, filePath);
        
        // Extract name and version
        const name = extractContentName(frontmatter, fallbackName);
        const version = extractContentVersion(frontmatter);
        
        const item: ContentItem = {
          contentType: definition.type,
          name,
          version,
          itemPath,
          manifestPath: itemPath, // For file-based, item and manifest are the same
          fallbackName,
          frontmatter: frontmatter as Record<string, any>
        };
        
        discoveredItems.push(item);
        logger.debug(`Discovered ${definition.singularName}`, {
          name,
          version,
          itemPath
        });
      } catch (error) {
        logger.warn(`Failed to process ${definition.singularName} file`, {
          filePath,
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue with other items
      }
    }
  } catch (error) {
    logger.error(`Error reading ${definition.pluralName} directory`, {
      contentDir,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  return discoveredItems;
}

/**
 * Determine content name with fallback logic.
 * 
 * Precedence:
 * 1. frontmatter.name (if present and non-empty)
 * 2. fallbackName (directory or filename)
 */
function extractContentName(frontmatter: Record<string, any>, fallbackName: string): string {
  if (frontmatter.name && String(frontmatter.name).trim().length > 0) {
    return String(frontmatter.name).trim();
  }
  
  logger.info('Using fallback name as content name (no frontmatter name)', { fallbackName });
  return fallbackName;
}

/**
 * Determine content version with precedence rules.
 * 
 * Precedence:
 * 1. frontmatter.version
 * 2. frontmatter.metadata.version
 * 3. undefined (let transformer decide default)
 */
function extractContentVersion(frontmatter: Record<string, any>): string | undefined {
  if (frontmatter.version) {
    return String(frontmatter.version);
  }
  
  if (frontmatter.metadata?.version) {
    return String(frontmatter.metadata.version);
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
 */
async function determineCollectionTypes(dirPath: string): Promise<ContentCollectionType[]> {
  const types: ContentCollectionType[] = [];
  
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

/**
 * Quick check if directory is a content collection.
 * 
 * @param dirPath - Absolute path to directory to check
 * @param contentType - Content type to check for
 * @returns True if directory contains content
 */
export async function isContentCollection(
  dirPath: string,
  contentType: ContentType
): Promise<boolean> {
  const result = await detectContentInDirectory(dirPath, contentType);
  return result.hasContent;
}

/**
 * Locate a content item by name with fallback to filename/dirname.
 * 
 * Matching is case-insensitive and tries:
 * 1. Exact match on item.name (frontmatter name)
 * 2. Exact match on item.fallbackName (directory/filename)
 * 
 * @param items - Array of discovered content items
 * @param searchName - Name to search for
 * @returns Matching content item or null if not found
 */
export function findContentByName(
  items: ContentItem[],
  searchName: string
): ContentItem | null {
  const normalizedSearch = searchName.trim().toLowerCase();
  
  // First pass: exact match on frontmatter name
  for (const item of items) {
    if (item.name.toLowerCase() === normalizedSearch) {
      return item;
    }
  }
  
  // Second pass: exact match on fallback name
  for (const item of items) {
    if (item.fallbackName.toLowerCase() === normalizedSearch) {
      return item;
    }
  }
  
  return null;
}

/**
 * Validate that all requested content items exist in the collection.
 * 
 * @param items - Array of discovered content items
 * @param requestedNames - Names of content items to validate
 * @returns Object with valid items array and invalid names array
 */
export function validateContentExists(
  items: ContentItem[],
  requestedNames: string[]
): { valid: ContentItem[]; invalid: string[] } {
  const valid: ContentItem[] = [];
  const invalid: string[] = [];
  
  for (const name of requestedNames) {
    const item = findContentByName(items, name);
    if (item) {
      valid.push(item);
    } else {
      invalid.push(name);
    }
  }
  
  return { valid, invalid };
}
