/**
 * Content Path Parser
 * 
 * Generalized utilities for detecting and parsing content paths (skills, agents, etc.).
 * Used during bulk installation to detect when a manifest dependency points to a
 * content subdirectory.
 */

import { logger } from '../../utils/logger.js';
import { detectContentTypeFromPath, getContentTypeDefinition, type ContentType } from './content-type-registry.js';

/**
 * Result of content path detection
 */
export interface ContentPathInfo {
  /**
   * Whether this path points to content
   */
  isContent: boolean;
  
  /**
   * Content type (if detected)
   */
  contentType?: ContentType;
  
  /**
   * Parent path (e.g., "plugins/ui-design")
   */
  parentPath?: string;
  
  /**
   * Content-relative path within parent (e.g., "skills/mobile-ios-design" or "agents/code-review-assistant")
   */
  contentRelativePath?: string;
  
  /**
   * Content item name extracted from path (last segment or filename without extension)
   */
  contentName?: string;
  
  /**
   * Full path (same as input if valid)
   */
  fullPath?: string;
}

/**
 * Detect if a path points to a content directory (skill, agent, etc.).
 * 
 * A content path is identified by containing a content type directory pattern.
 * 
 * Examples:
 * - "plugins/ui-design/skills/mobile-ios-design" → skill
 * - "skills/git" → skill (root-level skills)
 * - "agents/code-review-assistant" → agent (root-level agents)
 * - "plugins/ui-design" → not content
 * 
 * @param gitPath - Git subdirectory path (from manifest "path" field)
 * @returns Content path information
 */
export function parseContentPath(gitPath: string | undefined): ContentPathInfo {
  if (!gitPath) {
    return { isContent: false };
  }
  
  // Normalize path (remove leading/trailing slashes)
  const normalizedPath = gitPath.replace(/^\/+|\/+$/g, '');
  
  // Detect content type from path
  const contentType = detectContentTypeFromPath(normalizedPath);
  
  if (!contentType) {
    return { isContent: false };
  }
  
  const definition = getContentTypeDefinition(contentType);
  const pattern = definition.directoryPattern;
  
  // Split on content directory pattern to separate parent and content paths
  let parentPath: string;
  let contentRelativePath: string;
  
  if (normalizedPath.startsWith(pattern)) {
    // Root-level content (no parent)
    parentPath = '';
    contentRelativePath = normalizedPath;
  } else {
    // Nested content (has parent path)
    const patternIndex = normalizedPath.indexOf(`/${pattern}`);
    parentPath = normalizedPath.substring(0, patternIndex);
    contentRelativePath = normalizedPath.substring(patternIndex + 1); // Include pattern
  }
  
  // Extract content name (last segment of path, or filename without extension for file-based)
  const segments = normalizedPath.split('/');
  let contentName = segments[segments.length - 1];
  
  // For file-based discovery (agents), remove .md extension if present
  if (definition.discoveryStrategy === 'file-based' && contentName.endsWith('.md')) {
    contentName = contentName.slice(0, -3);
  }
  
  // Validate content name is not empty
  if (!contentName) {
    logger.warn(`Invalid ${definition.singularName} path - missing ${definition.singularName} name`, { gitPath });
    return { isContent: false };
  }
  
  logger.debug(`Detected ${definition.singularName} path`, {
    gitPath,
    contentType,
    parentPath: parentPath || '(root)',
    contentRelativePath,
    contentName
  });
  
  return {
    isContent: true,
    contentType,
    parentPath: parentPath || undefined, // Empty string → undefined for root-level content
    contentRelativePath,
    contentName,
    fullPath: normalizedPath
  };
}

/**
 * Check if a path points to content (convenience function)
 * 
 * @param gitPath - Git subdirectory path
 * @returns True if path contains a content type directory pattern
 */
export function isContentPath(gitPath: string | undefined): boolean {
  return parseContentPath(gitPath).isContent;
}

/**
 * Extract content filter path for file discovery.
 * 
 * The content filter is the path relative to the parent directory
 * that should be used to filter files during installation.
 * 
 * @param contentInfo - Parsed content path info
 * @returns Content filter path for discovery options, or undefined if not content
 */
export function getContentFilterPath(contentInfo: ContentPathInfo): string | undefined {
  if (!contentInfo.isContent || !contentInfo.contentRelativePath) {
    return undefined;
  }
  
  return contentInfo.contentRelativePath;
}
