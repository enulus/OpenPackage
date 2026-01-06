/**
 * Map Pipeline Utilities
 * 
 * Shared utilities for map operations:
 * - Nested value access (get/set/delete)
 * - Pattern matching (glob and object shapes)
 * - Wildcard handling
 */

import { minimatch } from 'minimatch';

/**
 * Get nested value using dot notation
 * 
 * Examples:
 * - getNestedValue({ a: { b: 1 } }, "a.b") → 1
 * - getNestedValue({ a: { b: 1 } }, "x") → undefined
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
 * Creates intermediate objects as needed
 * 
 * Examples:
 * - setNestedValue({}, "a.b", 1) → { a: { b: 1 } }
 * - setNestedValue({ a: { c: 2 } }, "a.b", 1) → { a: { c: 2, b: 1 } }
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
    
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
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
 * 
 * Examples:
 * - deleteNestedValue({ a: { b: 1 } }, "a.b") → { a: {} }
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
 * Match value against pattern
 * Supports:
 * - String patterns with glob syntax (*, ?)
 * - Object shape matching
 * - Wildcard * to match any value
 * 
 * Examples:
 * - matchPattern("anthropic/claude-sonnet-4", "anthropic/claude-sonnet-*") → true
 * - matchPattern({ edit: "deny" }, { edit: "deny", bash: "deny" }) → false
 * - matchPattern({ edit: "deny", bash: "deny" }, { edit: "deny", bash: "deny" }) → true
 * - matchPattern("anything", "*") → true
 */
export function matchPattern(value: any, pattern: string | object): boolean {
  // Wildcard matches anything
  if (pattern === '*') {
    return true;
  }

  // String pattern matching with glob
  if (typeof pattern === 'string') {
    if (typeof value !== 'string') {
      return false;
    }
    return minimatch(value, pattern);
  }

  // Object shape matching
  if (typeof pattern === 'object' && pattern !== null) {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    // Check if all pattern keys match
    for (const [key, patternValue] of Object.entries(pattern)) {
      // Handle wildcard in object patterns
      if (key === '*') {
        // Check if all values match the pattern value
        const allValuesMatch = Object.values(value).every(v => {
          if (patternValue === '*') return true;
          return v === patternValue;
        });
        if (!allValuesMatch) return false;
      } else {
        // Exact key and value match required
        if (!(key in value)) {
          return false;
        }
        if (patternValue !== '*' && value[key] !== patternValue) {
          return false;
        }
      }
    }

    return true;
  }

  // Direct equality for other types
  return value === pattern;
}

/**
 * Get all flat keys (dot notation) from an object
 * 
 * Examples:
 * - getFlatKeys({ a: { b: 1 } }) → ["a", "a.b"]
 * - getFlatKeys({ x: 1, y: { z: 2 } }) → ["x", "y", "y.z"]
 */
export function getFlatKeys(obj: any, prefix = ''): string[] {
  const keys: string[] = [];

  if (typeof obj !== 'object' || obj === null) {
    return [];
  }

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.push(fullKey);

    // Recursively get nested keys (but not arrays)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getFlatKeys(value, fullKey));
    }
  }

  return keys;
}

/**
 * Parse wildcard pattern into prefix and suffix
 * 
 * Examples:
 * - parseWildcard("mcp.*") → { prefix: "mcp.", suffix: "" }
 * - parseWildcard("*.value") → { prefix: "", suffix: ".value" }
 * - parseWildcard("config.*.name") → { prefix: "config.", suffix: ".name" }
 */
export function parseWildcard(pattern: string): { prefix: string; suffix: string } {
  const wildcardIndex = pattern.indexOf('*');
  
  if (wildcardIndex === -1) {
    return { prefix: pattern, suffix: '' };
  }

  const prefix = pattern.substring(0, wildcardIndex);
  const suffix = pattern.substring(wildcardIndex + 1);

  return { prefix, suffix };
}

/**
 * Get keys matching wildcard pattern
 * 
 * Examples:
 * - getMatchingKeys({ mcp: { a: 1, b: 2 } }, "mcp.", "") → ["mcp.a", "mcp.b"]
 */
export function getMatchingKeys(obj: any, prefix: string, suffix: string): string[] {
  const flatKeys = getFlatKeys(obj);
  
  return flatKeys.filter(key => {
    if (prefix && !key.startsWith(prefix)) {
      return false;
    }
    if (suffix && !key.endsWith(suffix)) {
      return false;
    }
    // Ensure there's something between prefix and suffix
    const wildcardPart = extractWildcardPart(key, prefix, suffix);
    return wildcardPart.length > 0;
  });
}

/**
 * Extract the wildcard part from a matched key
 * 
 * Examples:
 * - extractWildcardPart("mcp.server1", "mcp.", "") → "server1"
 * - extractWildcardPart("config.db.name", "config.", ".name") → "db"
 */
export function extractWildcardPart(key: string, prefix: string, suffix: string): string {
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
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as any;
  }

  const cloned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    cloned[key] = deepClone(value);
  }

  return cloned;
}
