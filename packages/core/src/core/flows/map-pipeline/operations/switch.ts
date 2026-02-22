/**
 * $switch Operation
 * 
 * Pattern matching with value replacement.
 * First match wins (like switch statements).
 */

import type { SwitchOperation } from '../types.js';
import { getNestedValue, setNestedValue, matchPattern } from '../utils.js';

/**
 * Execute $switch operation
 * 
 * Examples:
 * {
 *   "$switch": {
 *     "field": "model",
 *     "cases": [
 *       { "pattern": "anthropic/claude-sonnet-*", "value": "sonnet" },
 *       { "pattern": "anthropic/claude-opus-*", "value": "opus" }
 *     ],
 *     "default": "inherit"
 *   }
 * }
 */
export function executeSwitch(
  document: any,
  operation: SwitchOperation
): any {
  const result = { ...document };
  const { field, cases, default: defaultValue } = operation.$switch;

  // Get current value
  const currentValue = getNestedValue(result, field);

  // If field doesn't exist, don't apply any transformation
  // This prevents creating fields that weren't in the original document
  if (currentValue === undefined) {
    return result;
  }

  // Try each case in order (first match wins)
  for (const { pattern, value } of cases) {
    if (matchPattern(currentValue, pattern)) {
      setNestedValue(result, field, value);
      return result;
    }
  }

  // No match - use default if provided (only when field exists)
  if (defaultValue !== undefined) {
    setNestedValue(result, field, defaultValue);
  }

  return result;
}

/**
 * Validate $switch operation
 */
export function validateSwitch(operation: SwitchOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!operation.$switch || typeof operation.$switch !== 'object') {
    errors.push('$switch must be an object');
    return { valid: false, errors };
  }

  const config = operation.$switch;

  if (!config.field || typeof config.field !== 'string') {
    errors.push('$switch.field must be a non-empty string');
  }

  if (!config.cases || !Array.isArray(config.cases)) {
    errors.push('$switch.cases must be an array');
    return { valid: errors.length === 0, errors };
  }

  if (config.cases.length === 0) {
    errors.push('$switch.cases must have at least one case');
  }

  for (let i = 0; i < config.cases.length; i++) {
    const switchCase = config.cases[i];
    
    if (!switchCase || typeof switchCase !== 'object') {
      errors.push(`$switch.cases[${i}] must be an object`);
      continue;
    }

    if (!('pattern' in switchCase)) {
      errors.push(`$switch.cases[${i}] must have a "pattern" field`);
    }

    if (!('value' in switchCase)) {
      errors.push(`$switch.cases[${i}] must have a "value" field`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
