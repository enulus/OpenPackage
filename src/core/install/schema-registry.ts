/**
 * Schema Registry Module
 * 
 * Loads, caches, and provides access to format detection schemas.
 * Schemas are referenced from platforms.jsonc flows and define format-specific
 * field signatures for detection.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';
import type { Flow, FlowContext, SwitchExpression } from '../../types/flows.js';
import type { 
  DetectionSchema, 
  FlowPattern,
  PlatformId 
} from './detection-types.js';
import { resolveSwitchExpressionFull } from '../flows/switch-resolver.js';

// Get the path to platforms.jsonc for resolving relative schema paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../../../');
const platformsJsoncPath = join(projectRoot, 'platforms.jsonc');

/**
 * Schema Registry
 * 
 * Singleton registry for loading and caching format detection schemas.
 * Schemas are lazy-loaded on first access and cached for reuse.
 */
class SchemaRegistry {
  private schemaCache = new Map<string, DetectionSchema>();

  /**
   * Load a schema from an explicit path
   * 
   * @param schemaPath - Relative path from platforms.jsonc (e.g., "./schemas/formats/claude-agent.schema.json")
   * @returns Parsed JSON schema with detection extensions
   */
  loadSchema(schemaPath: string): DetectionSchema | null {
    // Check cache first
    if (this.schemaCache.has(schemaPath)) {
      return this.schemaCache.get(schemaPath)!;
    }

    try {
      // Resolve path relative to platforms.jsonc location
      const resolvedPath = this.resolveSchemaPath(schemaPath);
      
      logger.debug(`Loading schema from ${resolvedPath}`);
      const content = readFileSync(resolvedPath, 'utf-8');
      const schema = JSON.parse(content) as DetectionSchema;
      
      // Validate basic structure
      if (!schema.$schema || !schema.properties) {
        logger.warn(`Schema at ${schemaPath} is missing required fields ($schema, properties)`);
        return null;
      }
      
      // Cache and return
      this.schemaCache.set(schemaPath, schema);
      return schema;
    } catch (error) {
      logger.warn(`Failed to load schema from ${schemaPath}:`, error);
      return null;
    }
  }

  /**
   * Resolve schema path relative to platforms.jsonc
   */
  private resolveSchemaPath(schemaPath: string): string {
    // Remove leading "./" if present
    const cleanPath = schemaPath.replace(/^\.\//, '');
    return join(dirname(platformsJsoncPath), cleanPath);
  }

  /**
   * Get schema for a flow's 'from' or 'to' pattern
   * 
   * @param flow - Flow object (may use string or object patterns)
   * @param direction - Which pattern to extract schema from ('from' or 'to')
   * @param context - Optional flow context for resolving $switch expressions
   * @returns Schema if pattern has schema reference, null otherwise
   */
  getSchemaForFlow(flow: Flow, direction: 'from' | 'to', context?: FlowContext): DetectionSchema | null {
    const pattern = flow[direction];
    
    // Handle switch expressions - resolve with context if available
    if (typeof pattern === 'object' && '$switch' in pattern) {
      if (!context) {
        // Without context, cannot resolve switch expression
        return null;
      }
      
      try {
        const result = resolveSwitchExpressionFull(pattern as SwitchExpression, context);
        if (result.schema) {
          return this.loadSchema(result.schema);
        }
        return null;
      } catch {
        // If switch resolution fails, return null
        return null;
      }
    }
    
    // Extract schema path from pattern
    const schemaPath = this.extractSchemaPath(pattern, direction);
    if (!schemaPath) {
      return null;
    }
    
    return this.loadSchema(schemaPath);
  }

  /**
   * Extract schema path from a pattern (string, array, or object)
   */
  private extractSchemaPath(
    pattern: string | string[] | FlowPattern | Record<string, any>,
    direction: 'from' | 'to'
  ): string | null {
    // String pattern - no schema
    if (typeof pattern === 'string') {
      return null;
    }
    
    // Array of patterns - check if first element has schema (for 'from' only)
    if (Array.isArray(pattern) && direction === 'from') {
      if (pattern.length === 0) return null;
      
      const first = pattern[0];
      if (typeof first === 'object' && 'schema' in first) {
        return (first as FlowPattern).schema || null;
      }
      return null;
    }
    
    // Object pattern - check for schema field
    if (typeof pattern === 'object' && pattern !== null && 'schema' in pattern) {
      return (pattern as FlowPattern).schema || null;
    }
    
    return null;
  }

  /**
   * Get all schemas referenced in platform flows
   * 
   * @param platforms - Platform definitions registry
   * @returns Map of schema path -> loaded schema
   */
  getAllFlowSchemas(platforms: Record<PlatformId, any>): Map<string, DetectionSchema> {
    const schemas = new Map<string, DetectionSchema>();
    
    for (const [platformId, def] of Object.entries(platforms)) {
      // Process import flows (workspace -> package, used for detection)
      if (def.import && Array.isArray(def.import)) {
        for (const flow of def.import) {
          const schema = this.getSchemaForFlow(flow, 'from');
          if (schema) {
            const schemaPath = this.extractSchemaPath(flow.from, 'from');
            if (schemaPath) {
              schemas.set(schemaPath, schema);
            }
          }
        }
      }
    }
    
    return schemas;
  }

  /**
   * Clear the schema cache
   * Useful for testing or reloading schemas
   */
  clearCache(): void {
    this.schemaCache.clear();
  }

  /**
   * Get number of cached schemas
   */
  getCacheSize(): number {
    return this.schemaCache.size;
  }
}

// Export singleton instance
export const schemaRegistry = new SchemaRegistry();

/**
 * Helper: Get pattern string from flow (handles string, array, and object formats)
 * 
 * @param flow - Flow object
 * @param direction - Which pattern to extract ('from' or 'to')
 * @returns Pattern string (first pattern if array)
 */
export function getPatternFromFlow(flow: Flow, direction: 'from' | 'to'): string | null {
  const pattern = flow[direction];
  
  // Skip switch expressions
  if (typeof pattern === 'object' && pattern !== null && '$switch' in pattern) {
    return null;
  }
  
  // Skip MultiTargetFlows (can't extract single pattern)
  if (typeof pattern === 'object' && pattern !== null && !('pattern' in pattern) && !Array.isArray(pattern)) {
    return null;
  }
  
  // String pattern
  if (typeof pattern === 'string') {
    return pattern;
  }
  
  // Array of patterns (for 'from' only)
  if (Array.isArray(pattern) && direction === 'from') {
    if (pattern.length === 0) return null;
    
    const first = pattern[0];
    if (typeof first === 'string') {
      return first;
    }
    if (typeof first === 'object' && 'pattern' in first) {
      return (first as FlowPattern).pattern;
    }
    return null;
  }
  
  // Object pattern with 'pattern' field
  if (typeof pattern === 'object' && pattern !== null && 'pattern' in pattern) {
    return (pattern as unknown as FlowPattern).pattern;
  }
  
  return null;
}
