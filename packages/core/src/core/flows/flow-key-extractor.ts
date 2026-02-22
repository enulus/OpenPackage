/**
 * Flow Key Extractor
 * 
 * Utilities for extracting and tracking keys contributed by flows.
 * Used for precise removal during uninstall of merged files.
 */

/**
 * Extract all keys from an object (including nested paths with dot notation)
 * Used for tracking which keys a package contributes during merge operations
 * 
 * @param data - The data object to extract keys from
 * @param prefix - The current path prefix (for recursion)
 * @returns Array of dot-notated key paths
 * 
 * @example
 * extractAllKeys({ mcp: { server1: {}, server2: {} } })
 * // Returns: ["mcp.server1", "mcp.server2"]
 */
export function extractAllKeys(data: any, prefix: string = ''): string[] {
  if (typeof data !== 'object' || data === null) {
    return prefix ? [prefix] : [];
  }

  // Handle arrays - track the array itself, not individual elements
  if (Array.isArray(data)) {
    return prefix ? [prefix] : [];
  }

  const keys: string[] = [];
  for (const key of Object.keys(data)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
      // Recurse into nested objects
      keys.push(...extractAllKeys(data[key], fullPath));
    } else {
      // Leaf key (primitive, array, or null)
      keys.push(fullPath);
    }
  }

  return keys;
}

/**
 * Delete a key from an object using dot notation
 * Also cleans up empty parent objects
 * 
 * @param obj - The object to modify
 * @param keyPath - Dot-notated path to the key
 * 
 * @example
 * const obj = { mcp: { server1: {}, server2: {} } };
 * deleteNestedKey(obj, "mcp.server1");
 * // obj is now: { mcp: { server2: {} } }
 */
export function deleteNestedKey(obj: any, keyPath: string): void {
  const parts = keyPath.split('.');
  const last = parts.pop()!;

  let current = obj;
  const path: any[] = [obj];
  
  for (const part of parts) {
    if (!current[part] || typeof current[part] !== 'object') {
      return; // Path doesn't exist
    }
    current = current[part];
    path.push(current);
  }

  delete current[last];

  // Clean up empty parent objects (bottom-up)
  for (let i = path.length - 1; i > 0; i--) {
    const parent = path[i];
    if (Object.keys(parent).length === 0) {
      // Find the key in the parent's parent
      const grandparent = path[i - 1];
      const keyInGrandparent = parts[i - 1];
      if (keyInGrandparent) {
        delete grandparent[keyInGrandparent];
      }
    } else {
      break; // Stop when we find a non-empty parent
    }
  }
}

/**
 * Check if an object is effectively empty (recursively)
 * 
 * @param data - The data to check
 * @returns True if empty or all nested objects are empty
 */
export function isEffectivelyEmpty(data: any): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data !== 'object') return false;
  if (Array.isArray(data)) return data.length === 0;

  const keys = Object.keys(data);
  if (keys.length === 0) return true;

  // Check if all nested objects are also empty
  return keys.every(key => isEffectivelyEmpty(data[key]));
}
