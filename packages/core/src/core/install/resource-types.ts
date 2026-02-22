/**
 * Resource type definitions for resource discovery and selection
 */

import { type InstallableResourceTypeId } from '../resources/resource-registry.js';

/**
 * Type of resource that can be discovered and installed
 */
export type ResourceType = InstallableResourceTypeId;

/**
 * Discovered resource metadata
 */
export interface DiscoveredResource {
  /** Type of resource */
  resourceType: ResourceType;
  
  /** Path relative to repository root */
  resourcePath: string;
  
  /** Display name (from frontmatter or filename) */
  displayName: string;
  
  /** Description from frontmatter */
  description?: string;
  
  /** Version from frontmatter */
  version?: string;
  
  /** Absolute file path for installation */
  filePath: string;
  
  /** Installation kind */
  installKind: 'file' | 'directory';
  
  /** How the resource was matched (for debugging) */
  matchedBy?: 'frontmatter' | 'filename' | 'dirname';
}

/**
 * Resource discovery result grouped by type
 */
export interface ResourceDiscoveryResult {
  /** All discovered resources */
  all: DiscoveredResource[];
  
  /** Resources grouped by type */
  byType: Map<ResourceType, DiscoveredResource[]>;
  
  /** Total count */
  total: number;
  
  /** Base path used for discovery */
  basePath: string;
  
  /** Repository root path */
  repoRoot: string;
}

/**
 * Selected resource for installation
 */
export interface SelectedResource {
  /** Type of resource */
  resourceType: ResourceType;
  
  /** Path relative to repository root */
  resourcePath: string;
  
  /** Display name */
  displayName: string;
  
  /** Absolute file path */
  filePath: string;
  
  /** Installation kind */
  installKind: 'file' | 'directory';
  
  /** Version */
  version?: string;
}
