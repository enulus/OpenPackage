/**
 * $set Operation
 * 
 * Sets field values with context variable resolution.
 * Supports dot notation for nested fields.
 */

import type { SetOperation, MapContext } from '../types.js';
import { setNestedValue } from '../utils.js';
import { resolveValue } from '../context.js';

/**
 * Execute $set operation
 * 
 * Examples:
 * - { "$set": { "name": "$$filename" } }
 * - { "$set": { "name": "$$filename", "version": "1.0.0" } }
 * - { "$set": { "config.model": "sonnet" } }
 */
export function executeSet(
  document: any,
  operation: SetOperation,
  context: MapContext
): any {
  const result = { ...document };
  const fields = operation.$set;

  for (const [fieldPath, value] of Object.entries(fields)) {
    // Resolve context variables in the value
    const resolvedValue = resolveValue(value, context);
    
    // Set the value using dot notation
    setNestedValue(result, fieldPath, resolvedValue);
  }

  return result;
}

/**
 * Validate $set operation
 */
export function validateSet(operation: SetOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!operation.$set || typeof operation.$set !== 'object') {
    errors.push('$set must be an object');
    return { valid: false, errors };
  }

  if (Object.keys(operation.$set).length === 0) {
    errors.push('$set must have at least one field');
  }

  for (const [key, value] of Object.entries(operation.$set)) {
    if (!key || key.trim() === '') {
      errors.push('$set field path cannot be empty');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
