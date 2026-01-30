/**
 * Content Type Registry
 * 
 * Central registry for content types (skills, agents, etc.) that can be
 * installed individually from collections. Defines the structure and
 * discovery rules for each content type.
 */

import type { DiscoveredSkill } from './skills-detector.js';

/**
 * Supported content types
 */
export type ContentType = 'skills' | 'agents';

/**
 * Strategy for discovering content items within a directory
 */
export type DiscoveryStrategy = 'manifest-based' | 'file-based';

/**
 * Definition of a content type
 */
export interface ContentTypeDefinition {
  /** Content type identifier */
  type: ContentType;
  
  /** Directory pattern to identify content (e.g., 'skills/', 'agents/') */
  directoryPattern: string;
  
  /** Discovery strategy for finding items */
  discoveryStrategy: DiscoveryStrategy;
  
  /** Manifest file name (for manifest-based discovery) */
  manifestFile?: string;
  
  /** File pattern (for file-based discovery) */
  filePattern?: string;
  
  /** Human-readable singular name */
  singularName: string;
  
  /** Human-readable plural name */
  pluralName: string;
}

/**
 * Generic content item information
 */
export interface ContentItem {
  /** Content type */
  contentType: ContentType;
  
  /** Item name (from frontmatter or fallback) */
  name: string;
  
  /** Item version (optional) */
  version?: string;
  
  /** Relative path to item directory or file */
  itemPath: string;
  
  /** Relative path to manifest file (for manifest-based) */
  manifestPath?: string;
  
  /** Fallback name (directory or filename without extension) */
  fallbackName: string;
  
  /** Parsed frontmatter */
  frontmatter: Record<string, any>;
}

/**
 * Detection result for a content type
 */
export interface ContentDetectionResult {
  /** Whether content was found */
  hasContent: boolean;
  
  /** Content type */
  contentType: ContentType;
  
  /** All discovered content items */
  discoveredItems: ContentItem[];
}

/**
 * Content type registry
 */
const contentTypeRegistry = new Map<ContentType, ContentTypeDefinition>();

/**
 * Register skills content type
 */
contentTypeRegistry.set('skills', {
  type: 'skills',
  directoryPattern: 'skills/',
  discoveryStrategy: 'manifest-based',
  manifestFile: 'SKILL.md',
  singularName: 'skill',
  pluralName: 'skills'
});

/**
 * Register agents content type
 */
contentTypeRegistry.set('agents', {
  type: 'agents',
  directoryPattern: 'agents/',
  discoveryStrategy: 'file-based',
  filePattern: '*.md',
  singularName: 'agent',
  pluralName: 'agents'
});

/**
 * Get content type definition
 * 
 * @param type - Content type
 * @returns Content type definition
 * @throws Error if content type is not registered
 */
export function getContentTypeDefinition(type: ContentType): ContentTypeDefinition {
  const definition = contentTypeRegistry.get(type);
  if (!definition) {
    throw new Error(`Content type '${type}' is not registered`);
  }
  return definition;
}

/**
 * Get all registered content types
 * 
 * @returns Array of content type definitions
 */
export function getAllContentTypes(): ContentTypeDefinition[] {
  return Array.from(contentTypeRegistry.values());
}

/**
 * Detect content type from path
 * 
 * Checks if path contains a known content type directory pattern.
 * 
 * @param path - Path to check
 * @returns Content type if detected, undefined otherwise
 */
export function detectContentTypeFromPath(path: string | undefined): ContentType | undefined {
  if (!path) {
    return undefined;
  }
  
  const normalizedPath = path.replace(/^\/+|\/+$/g, '');
  
  for (const definition of contentTypeRegistry.values()) {
    const pattern = definition.directoryPattern;
    if (normalizedPath.includes(`/${pattern}`) || normalizedPath.startsWith(pattern)) {
      return definition.type;
    }
  }
  
  return undefined;
}

/**
 * Convert DiscoveredSkill to generic ContentItem
 * 
 * @param skill - Discovered skill
 * @returns Content item
 */
export function skillToContentItem(skill: DiscoveredSkill): ContentItem {
  return {
    contentType: 'skills',
    name: skill.name,
    version: skill.version,
    itemPath: skill.skillPath,
    manifestPath: skill.manifestPath,
    fallbackName: skill.directoryName,
    frontmatter: skill.frontmatter
  };
}
