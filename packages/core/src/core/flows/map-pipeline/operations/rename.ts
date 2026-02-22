/**
 * $rename Operation
 * 
 * Renames fields with support for:
 * - Simple renames
 * - Nested paths with dot notation
 * - Wildcard patterns (mcp.* → mcpServers.*)
 */

import type { RenameOperation } from '../types.js';
import {
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  parseWildcard,
  getMatchingKeys,
  extractWildcardPart,
} from '../utils.js';

/**
 * Execute $rename operation
 * 
 * Examples:
 * - { "$rename": { "oldName": "newName" } }
 * - { "$rename": { "mcp.*": "mcpServers.*" } }
 * - { "$rename": { "config.old": "settings.new" } }
 */
export function executeRename(
  document: any,
  operation: RenameOperation
): any {
  const result = { ...document };
  const mappings = operation.$rename;

  for (const [oldPath, newPath] of Object.entries(mappings)) {
    if (oldPath.includes('*')) {
      // Handle wildcard rename
      renameWithWildcard(result, oldPath, newPath);
    } else {
      // Simple rename
      renameSimple(result, oldPath, newPath);
    }
  }

  return result;
}

/**
 * Simple rename without wildcards
 */
function renameSimple(obj: any, oldPath: string, newPath: string): void {
  const value = getNestedValue(obj, oldPath);
  
  if (value !== undefined) {
    setNestedValue(obj, newPath, value);
    deleteNestedValue(obj, oldPath);
  }
}

/**
 * Rename with wildcard patterns
 * Both oldPath and newPath must have exactly one wildcard
 */
function renameWithWildcard(obj: any, oldPattern: string, newPattern: string): void {
  // Parse wildcards
  const { prefix: oldPrefix, suffix: oldSuffix } = parseWildcard(oldPattern);
  const { prefix: newPrefix, suffix: newSuffix } = parseWildcard(newPattern);

  // Find all matching keys
  const matchingKeys = getMatchingKeys(obj, oldPrefix, oldSuffix);

  // Rename each matching key
  for (const oldKey of matchingKeys) {
    // Extract the wildcard part
    const wildcardPart = extractWildcardPart(oldKey, oldPrefix, oldSuffix);
    
    // Construct new key
    const newKey = newPrefix + wildcardPart + newSuffix;
    
    // Get value and rename
    const value = getNestedValue(obj, oldKey);
    if (value !== undefined) {
      setNestedValue(obj, newKey, value);
      deleteNestedValue(obj, oldKey);
    }
  }
}

/**
 * Validate $rename operation
 */
export function validateRename(operation: RenameOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!operation.$rename || typeof operation.$rename !== 'object') {
    errors.push('$rename must be an object');
    return { valid: false, errors };
  }

  if (Object.keys(operation.$rename).length === 0) {
    errors.push('$rename must have at least one field mapping');
  }

  for (const [oldPath, newPath] of Object.entries(operation.$rename)) {
    if (!oldPath || oldPath.trim() === '') {
      errors.push('$rename source path cannot be empty');
    }

    if (!newPath || newPath.trim() === '') {
      errors.push('$rename target path cannot be empty');
    }

    // Validate wildcard usage
    const oldWildcards = (oldPath.match(/\*/g) || []).length;
    const newWildcards = (newPath.match(/\*/g) || []).length;

    if (oldWildcards !== newWildcards) {
      errors.push(
        `$rename wildcard mismatch: "${oldPath}" has ${oldWildcards} wildcard(s), ` +
        `but "${newPath}" has ${newWildcards} wildcard(s). Both must have the same count.`
      );
    }

    if (oldWildcards > 1) {
      errors.push(`$rename does not support multiple wildcards in one pattern: "${oldPath}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
