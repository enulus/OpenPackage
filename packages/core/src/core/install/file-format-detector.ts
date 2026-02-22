/**
 * File Format Detector Module
 * 
 * Detects format for individual files using schema-based scoring.
 * Core detection logic for per-file format analysis.
 */

import { minimatch } from 'minimatch';
import { logger } from '../../utils/logger.js';
import { splitFrontmatter } from '../../utils/markdown-frontmatter.js';
import { schemaRegistry, getPatternFromFlow } from './schema-registry.js';
import { getPlatformDefinitions, isPlatformId, matchesUniversalPattern } from '../platforms.js';
import { extractPlatformSuffixFromFilename } from '../flows/platform-suffix-handler.js';
import type { Flow } from '../../types/flows.js';
import type { 
  DetectionSchema,
  SchemaProperty,
  FileFormat,
  SchemaMatchResult,
  PackageFile,
  PlatformId
} from './detection-types.js';

/**
 * Detect format for a single file
 * 
 * Main entry point for file-level format detection.
 * Scores file against all platform schemas and returns best match.
 * 
 * @param file - Package file with path and optional content/frontmatter
 * @param targetDir - Optional target directory for local platform config
 * @returns Detected format with confidence score
 */
export function detectFileFormat(
  file: PackageFile,
  targetDir?: string
): FileFormat {
  // Parse frontmatter if not already parsed
  let frontmatter = file.frontmatter;
  if (!frontmatter && file.content) {
    const parsed = splitFrontmatter(file.content);
    frontmatter = parsed.frontmatter || {};
  }
  
  // No frontmatter - use path-based fallback for universal locations
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    // Files at universal paths (commands/, agents/, rules/, etc.) or config files
    // are already in universal format; treat as universal, not unknown
    const normalizedPath = file.path.replace(/\\/g, '/').replace(/^\.\/?/, '');
    if (matchesUniversalPattern(normalizedPath, targetDir)) {
      return {
        platform: 'universal',
        confidence: 0.3,
        matchedFlow: null,
        matchedSchema: null,
        matchedFields: [],
        path: file.path
      };
    }
    return {
      platform: 'unknown',
      confidence: 0,
      matchedFlow: null,
      matchedSchema: null,
      matchedFields: [],
      path: file.path
    };
  }
  
  // Score against all platform schemas
  const platforms = getPlatformDefinitions(targetDir);
  const matches: SchemaMatchResult[] = [];
  
  for (const [platformId, def] of Object.entries(platforms)) {
    // Check both export and import flows for schemas
    // Export flows: universal -> platform (has platform schema on 'to')
    // Import flows: platform -> universal (has platform schema on 'from')
    
    // Check export flows for platform format schemas (on 'to' field)
    if (def.export && def.export.length > 0) {
      for (const flow of def.export) {
        const schema = schemaRegistry.getSchemaForFlow(flow, 'to');
        if (!schema) continue;
        
        const match = scoreAgainstSchema(frontmatter, schema, flow, file.path, platformId);
        if (match.score > 0) {
          matches.push(match);
        }
      }
    }
    
    // Check import flows for platform format schemas (on 'from' field)
    if (def.import && def.import.length > 0) {
      for (const flow of def.import) {
        const schema = schemaRegistry.getSchemaForFlow(flow, 'from');
        if (!schema) continue;
        
        const match = scoreAgainstSchema(frontmatter, schema, flow, file.path, platformId);
        if (match.score > 0) {
          matches.push(match);
        }
      }
    }
  }
  
  // No matches - use path-based platform suffix if present (e.g. foo.opencode.md)
  if (matches.length === 0) {
    const pathPlatform = extractPlatformSuffixFromFilename(file.path);
    if (pathPlatform && isPlatformId(pathPlatform)) {
      return {
        platform: pathPlatform,
        confidence: 0.7,
        matchedFlow: null,
        matchedSchema: null,
        matchedFields: [],
        path: file.path
      };
    }
    return {
      platform: 'universal',
      confidence: 0.3,
      matchedFlow: null,
      matchedSchema: null,
      matchedFields: [],
      path: file.path
    };
  }
  
  // Select best match
  const bestMatch = matches.reduce((best, current) => 
    current.score > best.score ? current : best
  );
  
  return {
    platform: bestMatch.platform,
    confidence: Math.min(1.0, bestMatch.score / bestMatch.maxScore),
    matchedFlow: bestMatch.flow,
    matchedSchema: bestMatch.schemaPath,
    matchedFields: bestMatch.matchedFields,
    path: file.path
  };
}

/**
 * Score frontmatter against a schema
 * 
 * Calculates confidence score based on:
 * - Field presence and type matching
 * - Detection weights from schema
 * - Exclusive field bonuses
 * - Path pattern matching boost
 * 
 * @param frontmatter - Parsed frontmatter object
 * @param schema - Detection schema with x-detection-weight extensions
 * @param flow - Flow that references this schema
 * @param filePath - File path for pattern matching
 * @param platformId - Platform ID for result
 * @returns Schema match result with score breakdown
 */
export function scoreAgainstSchema(
  frontmatter: Record<string, any>,
  schema: DetectionSchema,
  flow: Flow,
  filePath: string,
  platformId: PlatformId
): SchemaMatchResult {
  let score = 0;
  let maxScore = 0;
  const matchedFields: string[] = [];
  
  // Score each field
  if (schema.properties) {
    for (const [fieldName, property] of Object.entries(schema.properties)) {
      const weight = property['x-detection-weight'] || 0.1;
      maxScore += weight;
      
      // Check if field exists in frontmatter
      if (!(fieldName in frontmatter)) {
        continue;
      }
      
      const value = frontmatter[fieldName];
      
      // Validate against schema constraints
      if (!validateFieldAgainstSchema(value, property)) {
        continue;
      }
      
      // Field matches - add weight
      score += weight;
      matchedFields.push(fieldName);
      
      // Bonus for exclusive fields
      if (property['x-exclusive']) {
        score += 0.1;
      }
    }
  }
  
  // Add path boost if file matches flow pattern
  const pathBoost = getPathBoost(filePath, flow);
  score += pathBoost;
  
  // Extract schema path from flow
  const schemaPath = extractSchemaPathFromFlow(flow);
  
  return {
    platform: platformId,
    schemaPath: schemaPath || 'unknown',
    flow,
    score,
    maxScore,
    matchedFields,
    pathBoost
  };
}

/**
 * Validate a value against schema property constraints
 * 
 * Checks type, enum, pattern, etc.
 */
function validateFieldAgainstSchema(
  value: any,
  property: SchemaProperty
): boolean {
  // Check type
  if (property.type) {
    const types = Array.isArray(property.type) ? property.type : [property.type];
    const valueType = getValueType(value);
    
    if (!types.includes(valueType)) {
      return false;
    }
  }
  
  // Check enum
  if (property.enum && !property.enum.includes(value)) {
    return false;
  }
  
  // Check pattern (for strings)
  if (property.pattern && typeof value === 'string') {
    const regex = new RegExp(property.pattern);
    if (!regex.test(value)) {
      return false;
    }
  }
  
  // Check array items
  if (property.type === 'array' && Array.isArray(value)) {
    if (property.items) {
      // Basic validation - all items should match item schema type
      if (property.items.type) {
        const itemType = property.items.type;
        for (const item of value) {
          if (getValueType(item) !== itemType) {
            return false;
          }
        }
      }
    }
  }
  
  // Check object properties
  if (property.type === 'object' && typeof value === 'object' && value !== null) {
    // Basic validation passed - could add more detailed object validation
    return true;
  }
  
  return true;
}

/**
 * Get JSON Schema type for a value
 */
function getValueType(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Get path boost for file matching flow pattern
 * 
 * @param filePath - File path to check
 * @param flow - Flow with pattern
 * @returns Boost value (0-0.2)
 */
function getPathBoost(filePath: string, flow: Flow): number {
  const pattern = getPatternFromFlow(flow, 'from');
  if (!pattern) {
    return 0;
  }
  
  // Check if file path matches pattern
  if (matchGlob(filePath, pattern)) {
    return 0.2;
  }
  
  return 0;
}

/**
 * Match file path against glob pattern
 */
function matchGlob(filePath: string, pattern: string): boolean {
  try {
    return minimatch(filePath, pattern);
  } catch (error) {
    logger.warn(`Invalid glob pattern: ${pattern}`, error);
    return false;
  }
}

/**
 * Extract schema path from flow
 */
function extractSchemaPathFromFlow(flow: Flow): string | null {
  const from = flow.from;
  
  // Skip switch expressions
  if (typeof from === 'object' && from !== null && '$switch' in from) {
    return null;
  }
  
  // Array - check first element
  if (Array.isArray(from) && from.length > 0) {
    const first = from[0];
    if (typeof first === 'object' && 'schema' in first) {
      return (first as any).schema || null;
    }
    return null;
  }
  
  // Object with schema
  if (typeof from === 'object' && from !== null && 'schema' in from) {
    return (from as any).schema || null;
  }
  
  return null;
}

/**
 * Batch detect formats for multiple files
 * 
 * @param files - Array of package files
 * @param targetDir - Optional target directory
 * @returns Map of file path -> detected format
 */
export function detectFileFormats(
  files: PackageFile[],
  targetDir?: string
): Map<string, FileFormat> {
  const results = new Map<string, FileFormat>();
  
  for (const file of files) {
    const format = detectFileFormat(file, targetDir);
    results.set(file.path, format);
  }
  
  return results;
}

/**
 * Group files by detected format
 * 
 * @param formats - Map of file path -> format
 * @returns Map of platform -> file paths
 */
export function groupFilesByFormat(
  formats: Map<string, FileFormat>
): Map<PlatformId | 'unknown', string[]> {
  const groups = new Map<PlatformId | 'unknown', string[]>();
  
  for (const [filePath, format] of formats) {
    const platform = format.platform;
    const group = groups.get(platform) || [];
    group.push(filePath);
    groups.set(platform, group);
  }
  
  return groups;
}
