/**
 * $unset Operation
 * 
 * Removes fields from document.
 * Supports dot notation for nested fields.
 */

import type { UnsetOperation } from '../types.js';
import { deleteNestedValue } from '../utils.js';

/**
 * Execute $unset operation
 * 
 * Examples:
 * - { "$unset": "permission" }
 * - { "$unset": ["permission", "legacy", "temp"] }
 * - { "$unset": "config.deprecated" }
 */
export function executeUnset(
  document: any,
  operation: UnsetOperation
): any {
  const result = { ...document };
  const fields = Array.isArray(operation.$unset) ? operation.$unset : [operation.$unset];

  for (const fieldPath of fields) {
    deleteNestedValue(result, fieldPath);
  }

  return result;
}

/**
 * Validate $unset operation
 */
export function validateUnset(operation: UnsetOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!operation.$unset) {
    errors.push('$unset must be a string or array of strings');
    return { valid: false, errors };
  }

  const fields = Array.isArray(operation.$unset) ? operation.$unset : [operation.$unset];

  if (fields.length === 0) {
    errors.push('$unset must have at least one field');
  }

  for (const field of fields) {
    if (typeof field !== 'string') {
      errors.push('$unset field must be a string');
    } else if (!field || field.trim() === '') {
      errors.push('$unset field path cannot be empty');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
