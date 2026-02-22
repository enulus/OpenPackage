/**
 * Flow Key Mapper
 * 
 * Implements sophisticated key transformations for the flow execution pipeline.
 * Supports dot notation, wildcard patterns, value transforms, lookup tables, and defaults.
 */

import { logger } from '../../utils/logger.js';
import { defaultTransformRegistry } from './flow-transforms.js';
import type { KeyMap, KeyMapConfig, FlowContext } from '../../types/flows.js';

/**
 * Map a single key (simple or nested with dot notation)
 */
function mapSingleKey(
  obj: any,
  sourceKey: string,
  targetConfig: string | KeyMapConfig,
  result: any,
  context: FlowContext,
  mappedKeys: Set<string>
): void {
  const target = typeof targetConfig === 'string' ? targetConfig : targetConfig.to;
  const config = typeof targetConfig === 'object' ? targetConfig : undefined;

  // Get source value
  const value = getNestedValue(obj, sourceKey);

  // Track that we've processed this key
  markKeyAsMapped(sourceKey, mappedKeys);

  // Handle missing value
  if (value === undefined) {
    // Use default value if provided
    if (config?.default !== undefined) {
      const transformedValue = applyValueTransform(config.default, config, context);
      setNestedValue(result, target, transformedValue);
    } else if (config?.required) {
      logger.warn(`Required key missing: ${sourceKey}`);
    }
    return;
  }

  // Transform the value
  const transformedValue = applyValueTransform(value, config, context);

  // Skip if value is null/undefined and not required
  if ((transformedValue === null || transformedValue === undefined) && config?.required === false) {
    return;
  }

  // Set the transformed value in result
  setNestedValue(result, target, transformedValue);
}

/**
 * Map keys using wildcard patterns
 * 
 * Examples:
 * - "ai.*" → "cursor.*" (map all keys under ai to cursor)
 * - "servers.*" → "mcp.servers.*" (map to nested path)
 */
function mapWildcard(
  obj: any,
  pattern: string,
  targetConfig: string | KeyMapConfig,
  result: any,
  context: FlowContext,
  mappedKeys: Set<string>
): void {
  const targetPattern = typeof targetConfig === 'string' ? targetConfig : targetConfig.to;
  const config = typeof targetConfig === 'object' ? targetConfig : undefined;

  // Parse pattern and target
  const { prefix: sourcePrefix, suffix: sourceSuffix } = parseWildcardPattern(pattern);
  const { prefix: targetPrefix, suffix: targetSuffix } = parseWildcardPattern(targetPattern);

  // Get all matching keys
  const matchingKeys = getMatchingKeys(obj, sourcePrefix, sourceSuffix);

  for (const key of matchingKeys) {
    // Extract the wildcard part
    const wildcardPart = extractWildcardPart(key, sourcePrefix, sourceSuffix);

    // Construct target key
    const targetKey = targetPrefix + wildcardPart + targetSuffix;

    // Get value
    const value = getNestedValue(obj, key);

    // Track as mapped
    markKeyAsMapped(key, mappedKeys);

    // Transform value
    if (value !== undefined) {
      const transformedValue = applyValueTransform(value, config, context);
      setNestedValue(result, targetKey, transformedValue);
    }
  }
}

/**
 * Parse wildcard pattern into prefix and suffix
 * 
 * Examples:
 * - "ai.*" → { prefix: "ai.", suffix: "" }
 * - "*.value" → { prefix: "", suffix: ".value" }
 * - "servers.*.config" → { prefix: "servers.", suffix: ".config" }
 */
function parseWildcardPattern(pattern: string): { prefix: string; suffix: string } {
  const wildcardIndex = pattern.indexOf('*');
  
  if (wildcardIndex === -1) {
    return { prefix: pattern, suffix: '' };
  }

  const prefix = pattern.substring(0, wildcardIndex);
  const suffix = pattern.substring(wildcardIndex + 1);

  return { prefix, suffix };
}

/**
 * Get all keys matching a wildcard pattern
 */
function getMatchingKeys(obj: any, prefix: string, suffix: string): string[] {
  const flatKeys = getFlatKeys(obj);
  
  return flatKeys.filter(key => {
    if (prefix && !key.startsWith(prefix)) {
      return false;
    }
    if (suffix && !key.endsWith(suffix)) {
      return false;
    }
    return true;
  });
}

/**
 * Extract the wildcard part from a key
 */
function extractWildcardPart(key: string, prefix: string, suffix: string): string {
  let result = key;
  
  if (prefix) {
    result = result.substring(prefix.length);
  }
  
  if (suffix) {
    result = result.substring(0, result.length - suffix.length);
  }
  
  return result;
}

/**
 * Get all flat keys (dot notation) from an object
 */
function getFlatKeys(obj: any, prefix = ''): string[] {
  const keys: string[] = [];

  if (typeof obj !== 'object' || obj === null) {
    return [];
  }

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.push(fullKey);

    // Recursively get nested keys
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getFlatKeys(value, fullKey));
    }
  }

  return keys;
}

/**
 * Apply value transformations
 * 
 * Applies transforms and value lookups in order:
 * 1. Apply value lookup table (if provided)
 * 2. Apply transform functions (if provided)
 */
function applyValueTransform(
  value: any,
  config: KeyMapConfig | undefined,
  context: FlowContext
): any {
  if (!config) {
    return value;
  }

  let result = value;

  // Apply value lookup table first
  if (config.values && result in config.values) {
    result = config.values[result];
  }

  // Apply transform functions
  if (config.transform) {
    result = applyTransforms(result, config.transform, context);
  }

  return result;
}

/**
 * Apply one or more transforms to a value
 */
function applyTransforms(value: any, transforms: string | string[], context: FlowContext): any {
  const transformList = Array.isArray(transforms) ? transforms : [transforms];
  
  let result = value;

  for (const transformName of transformList) {
    try {
      // Check if transform exists
      if (defaultTransformRegistry.has(transformName)) {
        result = defaultTransformRegistry.execute(transformName, result);
      } else {
        logger.warn(`Unknown transform: ${transformName}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Transform '${transformName}' failed: ${errorMsg}`);
      // Continue with unmodified value on error
    }
  }

  return result;
}

/**
 * Get nested value using dot notation
 * 
 * Examples:
 * - getNestedValue({ a: { b: 1 } }, "a.b") → 1
 * - getNestedValue({ a: { b: 1 } }, "a.c") → undefined
 */
export function getNestedValue(obj: any, path: string): any {
  if (!path) {
    return obj;
  }

  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Set nested value using dot notation
 * 
 * Examples:
 * - setNestedValue({}, "a.b", 1) → { a: { b: 1 } }
 * - setNestedValue({ a: {} }, "a.b", 1) → { a: { b: 1 } }
 */
export function setNestedValue(obj: any, path: string, value: any): void {
  if (!path) {
    return;
  }

  const keys = path.split('.');
  let current = obj;

  // Navigate/create nested structure
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    
    current = current[key];
  }

  // Set final value
  const finalKey = keys[keys.length - 1];
  current[finalKey] = value;
}

/**
 * Delete nested value using dot notation
 */
export function deleteNestedValue(obj: any, path: string): void {
  if (!path) {
    return;
  }

  const keys = path.split('.');
  let current = obj;

  // Navigate to parent
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    
    if (!(key in current) || typeof current[key] !== 'object') {
      return; // Path doesn't exist
    }
    
    current = current[key];
  }

  // Delete final key
  const finalKey = keys[keys.length - 1];
  delete current[finalKey];
}

/**
 * Mark a key (and its nested parent keys) as mapped
 * 
 * Examples:
 * - markKeyAsMapped("a.b.c", set) adds "a", "a.b", "a.b.c" to set
 */
function markKeyAsMapped(key: string, mappedKeys: Set<string>): void {
  mappedKeys.add(key);

  // Also mark parent keys as mapped
  const parts = key.split('.');
  for (let i = 1; i < parts.length; i++) {
    const parentKey = parts.slice(0, i).join('.');
    mappedKeys.add(parentKey);
  }
}

/**
 * Copy unmapped keys from source to result
 * 
 * This preserves keys that are not explicitly mapped.
 */
function copyUnmappedKeys(source: any, result: any, mappedKeys: Set<string>): void {
  if (typeof source !== 'object' || source === null) {
    return;
  }

  // If result is an array, don't copy unmapped keys
  if (Array.isArray(result)) {
    return;
  }

  for (const key of Object.keys(source)) {
    if (!mappedKeys.has(key) && !(key in result)) {
      result[key] = source[key];
    }
  }
}


