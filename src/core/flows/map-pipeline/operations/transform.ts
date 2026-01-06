/**
 * $transform Operation
 * 
 * Pipeline transformation on a field.
 * Converts objects/arrays through a series of steps.
 */

import type { TransformOperation, TransformStep } from '../types.js';
import { getNestedValue, setNestedValue } from '../utils.js';

/**
 * Execute $transform operation
 * 
 * Example:
 * {
 *   "$transform": {
 *     "field": "tools",
 *     "steps": [
 *       { "filter": { "value": true } },
 *       { "keys": true },
 *       { "map": "capitalize" },
 *       { "join": ", " }
 *     ]
 *   }
 * }
 */
export function executeTransform(
  document: any,
  operation: TransformOperation
): any {
  const result = { ...document };
  const { field, steps } = operation.$transform;

  // Get current value
  let value = getNestedValue(result, field);

  // Apply each step in sequence
  for (const step of steps) {
    value = applyTransformStep(value, step);
  }

  // If the transformed value is an empty string or empty array, unset the field
  // This prevents fields like "tools: ''" which are semantically invalid
  if (value === '' || (Array.isArray(value) && value.length === 0)) {
    // Delete the field entirely using the utils function
    const pathParts = field.split('.');
    if (pathParts.length === 1) {
      delete result[field];
    } else {
      // For nested paths, we need to navigate and delete
      let current = result;
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (!(pathParts[i] in current)) {
          return result; // Path doesn't exist, nothing to delete
        }
        current = current[pathParts[i]];
      }
      delete current[pathParts[pathParts.length - 1]];
    }
  } else {
    // Set transformed value
    setNestedValue(result, field, value);
  }

  return result;
}

/**
 * Apply a single transform step
 */
function applyTransformStep(value: any, step: TransformStep): any {
  if ('filter' in step) {
    return applyFilter(value, step.filter);
  }

  if ('keys' in step) {
    return applyKeys(value);
  }

  if ('values' in step) {
    return applyValues(value);
  }

  if ('entries' in step) {
    return applyEntries(value);
  }

  if ('map' in step) {
    return applyMap(value, step.map);
  }

  if ('join' in step) {
    return applyJoin(value, step.join);
  }

  // Unknown step - return unchanged
  return value;
}

/**
 * Filter step: { "filter": { "value": true } }
 * Keeps entries where value or key matches
 */
function applyFilter(value: any, filter: { value?: any; key?: any }): any {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const result: any = {};

  for (const [key, val] of Object.entries(value)) {
    let keep = true;

    // Filter by value
    if ('value' in filter && val !== filter.value) {
      keep = false;
    }

    // Filter by key
    if ('key' in filter && key !== filter.key) {
      keep = false;
    }

    if (keep) {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Keys step: { "keys": true }
 * Extract object keys to array
 */
function applyKeys(value: any): any {
  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.keys(value);
}

/**
 * Values step: { "values": true }
 * Extract object values to array
 */
function applyValues(value: any): any {
  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.values(value);
}

/**
 * Entries step: { "entries": true }
 * Convert object to entries array [[key, value], ...]
 */
function applyEntries(value: any): any {
  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.entries(value);
}

/**
 * Map step: { "map": "capitalize" }
 * Transform each element in array
 */
function applyMap(value: any, transform: 'capitalize' | 'uppercase' | 'lowercase'): any {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map(item => {
    if (typeof item !== 'string') {
      return item;
    }

    switch (transform) {
      case 'capitalize':
        return item.charAt(0).toUpperCase() + item.slice(1);
      case 'uppercase':
        return item.toUpperCase();
      case 'lowercase':
        return item.toLowerCase();
      default:
        return item;
    }
  });
}

/**
 * Join step: { "join": ", " }
 * Join array to string
 */
function applyJoin(value: any, separator: string): any {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.join(separator);
}

/**
 * Validate $transform operation
 */
export function validateTransform(operation: TransformOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!operation.$transform || typeof operation.$transform !== 'object') {
    errors.push('$transform must be an object');
    return { valid: false, errors };
  }

  const config = operation.$transform;

  if (!config.field || typeof config.field !== 'string') {
    errors.push('$transform.field must be a non-empty string');
  }

  if (!config.steps || !Array.isArray(config.steps)) {
    errors.push('$transform.steps must be an array');
    return { valid: errors.length === 0, errors };
  }

  if (config.steps.length === 0) {
    errors.push('$transform.steps must have at least one step');
  }

  for (let i = 0; i < config.steps.length; i++) {
    const step = config.steps[i];
    
    if (!step || typeof step !== 'object') {
      errors.push(`$transform.steps[${i}] must be an object`);
      continue;
    }

    const stepKeys = Object.keys(step);
    if (stepKeys.length !== 1) {
      errors.push(`$transform.steps[${i}] must have exactly one operation`);
      continue;
    }

    const operation = stepKeys[0];
    const validOps = ['filter', 'keys', 'values', 'entries', 'map', 'join'];
    
    if (!validOps.includes(operation)) {
      errors.push(
        `$transform.steps[${i}] has unknown operation "${operation}". ` +
        `Valid: ${validOps.join(', ')}`
      );
    }

    // Validate specific operations
    if (operation === 'map') {
      const mapType = (step as any).map;
      const validMaps = ['capitalize', 'uppercase', 'lowercase'];
      if (!validMaps.includes(mapType)) {
        errors.push(
          `$transform.steps[${i}].map must be one of: ${validMaps.join(', ')}`
        );
      }
    }

    if (operation === 'join') {
      const separator = (step as any).join;
      if (typeof separator !== 'string') {
        errors.push(`$transform.steps[${i}].join must be a string`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
