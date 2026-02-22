/**
 * Detection Types Module
 * 
 * Type definitions for file-level format detection system.
 * Platform IDs are dynamic strings (any key from platforms.jsonc).
 */

import type { Flow } from '../../types/flows.js';

/**
 * Platform ID is a dynamic string - any key from platforms.jsonc
 * NOT a hardcoded union type. This enables extensibility without code changes.
 */
export type PlatformId = string;

/**
 * Special format values for edge cases
 */
export type SpecialFormat = 'universal' | 'unknown';

/**
 * Detected format for a single file
 */
export interface FileFormat {
  /** Platform ID from platforms.jsonc or special value */
  platform: PlatformId | SpecialFormat;
  
  /** Confidence score (0-1) normalized */
  confidence: number;
  
  /** The flow that matched (if any) */
  matchedFlow: Flow | null;
  
  /** Schema path that matched (if any) */
  matchedSchema: string | null;
  
  /** Fields that contributed to score */
  matchedFields: string[];
  
  /** Original file path */
  path: string;
}

/**
 * Flow pattern object with optional schema reference
 */
export interface FlowPattern {
  /** Glob pattern (e.g., "agents/**\/*.md") */
  pattern: string;
  
  /** Explicit path to schema (e.g., "./schemas/formats/claude-agent.schema.json") */
  schema?: string;
}

/**
 * Extended flow type supporting pattern objects with schema references
 * Note: This is a separate interface, not extending Flow, because the pattern types differ
 */
export interface FlowWithSchema {
  /** Source pattern(s) - can be string, array of strings, pattern objects, or switch expression */
  from: string | string[] | FlowPattern | FlowPattern[] | Flow['from'];
  
  /** Target pattern - can be string, pattern object, or switch expression */
  to: string | FlowPattern | Flow['to'];
  
  /** All other Flow properties */
  map?: Flow['map'];
  pick?: Flow['pick'];
  omit?: Flow['omit'];
  path?: Flow['path'];
  embed?: Flow['embed'];
  section?: Flow['section'];
  when?: Flow['when'];
  merge?: Flow['merge'];
  handler?: Flow['handler'];
  priority?: Flow['priority'];
  description?: Flow['description'];
}

/**
 * JSON Schema with detection extensions
 */
export interface DetectionSchema {
  $schema: string;
  $id: string;
  title: string;
  description?: string;
  type: string;
  properties?: {
    [key: string]: SchemaProperty;
  };
  'x-detection'?: {
    platform: string;
  };
}

/**
 * Schema property with detection extensions
 */
export interface SchemaProperty {
  type?: string | string[];
  enum?: any[];
  pattern?: string;
  items?: SchemaProperty;
  properties?: {
    [key: string]: SchemaProperty;
  };
  additionalProperties?: boolean | SchemaProperty;
  description?: string;
  
  /** Detection weight (0-1) - contribution to confidence score */
  'x-detection-weight'?: number;
  
  /** Field only exists in this platform format (stronger signal) */
  'x-exclusive'?: boolean;
}

/**
 * Detection result for a single file against a single schema
 */
export interface SchemaMatchResult {
  /** Platform ID from schema */
  platform: PlatformId;
  
  /** Schema path */
  schemaPath: string;
  
  /** Flow that referenced this schema */
  flow: Flow;
  
  /** Confidence score (0-1) */
  score: number;
  
  /** Maximum possible score for this schema */
  maxScore: number;
  
  /** Fields that matched */
  matchedFields: string[];
  
  /** Path boost applied (if file path matches flow pattern) */
  pathBoost: number;
}

/**
 * Package file interface for detection
 */
export interface PackageFile {
  /** File path relative to package root */
  path: string;
  
  /** File content (may be lazy-loaded) */
  content?: string;
  
  /** Parsed frontmatter (if markdown file) */
  frontmatter?: Record<string, any>;
}

/**
 * Special format identifier for mixed packages
 */
export type MixedFormat = 'mixed';

/**
 * Enhanced package format detection result
 * 
 * Comprehensive format analysis for entire package including:
 * - Overall package format
 * - Detection method used
 * - Per-file format breakdown
 * - Package-level markers found
 * - Distribution statistics
 */
export interface EnhancedPackageFormat {
  /**
   * Overall package format
   * - Dynamic platform ID from platforms.jsonc (e.g., 'claude', 'cursor', 'opencode')
   * - 'universal' - no platform-specific format detected
   * - 'mixed' - multiple platform formats detected
   * - 'unknown' - could not determine format
   */
  packageFormat: PlatformId | SpecialFormat | MixedFormat;
  
  /**
   * Detection method used
   * - 'package-marker' - Fast path via explicit markers (e.g., .claude-plugin/plugin.json)
   * - 'per-file' - Detailed path via schema-based per-file detection
   * - 'directory-structure' - Fallback via directory pattern analysis
   */
  detectionMethod: 'package-marker' | 'per-file' | 'directory-structure';
  
  /**
   * Overall confidence (0-1)
   * Higher = more certain about the format
   */
  confidence: number;
  
  /**
   * Per-file format breakdown (for mixed packages)
   * Map of file path -> detected format
   */
  fileFormats?: Map<string, FileFormat>;
  
  /**
   * Files grouped by platform ID
   * Map of platform -> array of file paths
   */
  formatGroups?: Map<PlatformId | SpecialFormat, string[]>;
  
  /**
   * Package-level markers found
   * Derived from platforms.jsonc detection arrays
   */
  markers?: {
    /** Patterns that matched from platforms.jsonc */
    matchedPatterns: Array<{ platformId: PlatformId; pattern: string }>;
    
    /** Whether openpackage.yml exists */
    hasOpenPackageYml?: boolean;
    
    /** Whether package.yml exists (legacy) */
    hasPackageYml?: boolean;
  };
  
  /**
   * Analysis metadata for debugging/logging
   */
  analysis: {
    /** Total files in package */
    totalFiles: number;
    
    /** Files analyzed (with frontmatter) */
    analyzedFiles: number;
    
    /** Files skipped (no frontmatter or non-markdown) */
    skippedFiles: number;
    
    /** Distribution by platform ID - count per platform */
    formatDistribution: Map<PlatformId | SpecialFormat, number>;
  };
}

/**
 * Format group - files grouped by detected platform
 * 
 * Used in Phase 3 for per-group conversion
 */
export interface FormatGroup {
  /** Platform ID for this group */
  platformId: PlatformId | SpecialFormat;
  
  /** Files in this group */
  files: PackageFile[];
  
  /** Average confidence across files */
  confidence: number;
}
