/**
 * $copy Operation
 * 
 * Copy field with optional pattern-based transformation.
 */

import type { CopyOperation } from '../types.js';
import { getNestedValue, setNestedValue, matchPattern } from '../utils.js';

/**
 * Execute $copy operation
 * 
 * Example:
 * {
 *   "$copy": {
 *     "from": "permission",
 *     "to": "permissionMode",
 *     "transform": {
 *       "cases": [
 *         { "pattern": { "edit": "deny", "bash": "deny" }, "value": "plan" }
 *       ],
 *       "default": "default"
 *     }
 *   }
 * }
 */
export function executeCopy(
  document: any,
  operation: CopyOperation
): any {
  const result = { ...document };
  const { from, to, transform } = operation.$copy;

  // Get source value
  const sourceValue = getNestedValue(result, from);

  // If source doesn't exist, don't set target
  if (sourceValue === undefined) {
    return result;
  }

  let targetValue = sourceValue;

  // Apply transformation if provided
  if (transform) {
    targetValue = applyTransform(sourceValue, transform);
  }

  // Set target value
  setNestedValue(result, to, targetValue);

  return result;
}

/**
 * Apply pattern-based transformation
 */
function applyTransform(
  value: any,
  transform: { cases: Array<{ pattern: string | object; value: any }>; default?: any }
): any {
  // Try each case in order (first match wins)
  for (const { pattern, value: caseValue } of transform.cases) {
    if (matchPattern(value, pattern)) {
      return caseValue;
    }
  }

  // No match - use default if provided, otherwise return original
  return transform.default !== undefined ? transform.default : value;
}

/**
 * Validate $copy operation
 */
export function validateCopy(operation: CopyOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!operation.$copy || typeof operation.$copy !== 'object') {
    errors.push('$copy must be an object');
    return { valid: false, errors };
  }

  const config = operation.$copy;

  if (!config.from || typeof config.from !== 'string') {
    errors.push('$copy.from must be a non-empty string');
  }

  if (!config.to || typeof config.to !== 'string') {
    errors.push('$copy.to must be a non-empty string');
  }

  // Validate transform if provided
  if (config.transform) {
    if (typeof config.transform !== 'object') {
      errors.push('$copy.transform must be an object');
      return { valid: errors.length === 0, errors };
    }

    if (!config.transform.cases || !Array.isArray(config.transform.cases)) {
      errors.push('$copy.transform.cases must be an array');
    } else {
      if (config.transform.cases.length === 0) {
        errors.push('$copy.transform.cases must have at least one case');
      }

      for (let i = 0; i < config.transform.cases.length; i++) {
        const caseItem = config.transform.cases[i];
        
        if (!caseItem || typeof caseItem !== 'object') {
          errors.push(`$copy.transform.cases[${i}] must be an object`);
          continue;
        }

        if (!('pattern' in caseItem)) {
          errors.push(`$copy.transform.cases[${i}] must have a "pattern" field`);
        }

        if (!('value' in caseItem)) {
          errors.push(`$copy.transform.cases[${i}] must have a "value" field`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
