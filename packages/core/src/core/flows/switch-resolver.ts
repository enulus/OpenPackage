/**
 * Switch Expression Resolver
 * 
 * Resolves $switch expressions in flow configurations to concrete target paths.
 * Inspired by MongoDB's $switch aggregation operator.
 */

import { minimatch } from 'minimatch';
import type { SwitchExpression, SwitchCase, SwitchCaseValue, FlowContext } from '../../types/flows.js';
import { smartEquals } from '../../utils/path-comparison.js';

/**
 * Result of resolving a switch expression
 * Contains both the resolved pattern string and optional schema
 */
export interface SwitchResolutionResult {
  /** Resolved pattern string */
  pattern: string;
  /** Optional schema path (if value was a FlowPattern with schema) */
  schema?: string;
}

/**
 * Extract pattern string from a SwitchCaseValue
 */
function extractPattern(value: SwitchCaseValue): string {
  if (typeof value === 'string') {
    return value;
  }
  return value.pattern;
}

/**
 * Extract schema from a SwitchCaseValue (if present)
 */
function extractSchema(value: SwitchCaseValue): string | undefined {
  if (typeof value === 'string') {
    return undefined;
  }
  return value.schema;
}

/**
 * Resolve a switch expression to a concrete target path
 * 
 * Evaluates cases in order and returns the value of the first matching case.
 * If no cases match and a default is provided, returns the default.
 * If no cases match and no default exists, throws an error.
 * 
 * @param switchExpr - The switch expression to resolve
 * @param context - Flow execution context with variables
 * @returns Resolved target path string (for backward compatibility)
 * @throws Error if no cases match and no default is provided
 */
export function resolveSwitchExpression(
  switchExpr: SwitchExpression,
  context: FlowContext
): string {
  return resolveSwitchExpressionFull(switchExpr, context).pattern;
}

/**
 * Resolve a switch expression to a full result with pattern and optional schema
 * 
 * @param switchExpr - The switch expression to resolve
 * @param context - Flow execution context with variables
 * @returns Full resolution result with pattern and optional schema
 * @throws Error if no cases match and no default is provided
 */
export function resolveSwitchExpressionFull(
  switchExpr: SwitchExpression,
  context: FlowContext
): SwitchResolutionResult {
  const { field, cases, default: defaultValue } = switchExpr.$switch;

  // Resolve the field value from context variables
  const fieldValue = resolveFieldValue(field, context);

  // Evaluate cases in order (first match wins)
  for (const switchCase of cases) {
    if (matchesPattern(fieldValue, switchCase.pattern)) {
      return {
        pattern: extractPattern(switchCase.value),
        schema: extractSchema(switchCase.value),
      };
    }
  }

  // No match - return default or throw error
  if (defaultValue !== undefined) {
    return {
      pattern: extractPattern(defaultValue),
      schema: extractSchema(defaultValue),
    };
  }

  throw new Error(
    `No matching case in $switch expression for ${field}=${JSON.stringify(fieldValue)}, and no default provided`
  );
}

/**
 * Resolve a field value from context variables
 * Handles $$variable references
 */
function resolveFieldValue(field: string, context: FlowContext): any {
  if (field.startsWith('$$')) {
    const varName = field.slice(2);
    if (!(varName in context.variables)) {
      throw new Error(`Variable '${varName}' not found in flow context`);
    }
    return context.variables[varName];
  }
  
  // Direct value (not a variable reference)
  return field;
}

/**
 * Check if a value matches a pattern
 * 
 * Supports:
 * - String equality (using smartEquals for path normalization)
 * - Glob patterns (*, **, etc.)
 * - Object deep equality
 */
function matchesPattern(value: any, pattern: string | object): boolean {
  // Object pattern - deep equality check
  if (typeof pattern === 'object' && pattern !== null) {
    return deepEquals(value, pattern);
  }

  // String pattern
  if (typeof pattern === 'string') {
    // If pattern contains glob characters, use minimatch
    if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[')) {
      return minimatch(String(value), pattern);
    }

    // Exact match using smart comparison (handles ~/ normalization)
    return smartEquals(value, pattern);
  }

  // Fallback to strict equality
  return value === pattern;
}

/**
 * Deep equality check for objects
 */
function deepEquals(a: any, b: any): boolean {
  if (a === b) return true;
  
  if (typeof a !== typeof b) return false;
  
  if (a === null || b === null) return a === b;
  
  if (typeof a !== 'object') return a === b;
  
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEquals(item, b[index]));
  }
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  return keysA.every(key => keysB.includes(key) && deepEquals(a[key], b[key]));
}

/**
 * Validate a switch expression
 * Returns validation result with error messages
 */
export function validateSwitchExpression(
  switchExpr: SwitchExpression
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!switchExpr.$switch) {
    errors.push('Switch expression must have $switch property');
    return { valid: false, errors };
  }

  const { field, cases, default: defaultValue } = switchExpr.$switch;

  // Validate field
  if (!field) {
    errors.push('Switch expression missing required field: field');
  } else if (typeof field !== 'string') {
    errors.push('Switch expression field must be a string');
  }

  // Validate cases
  if (!cases) {
    errors.push('Switch expression missing required field: cases');
  } else if (!Array.isArray(cases)) {
    errors.push('Switch expression cases must be an array');
  } else if (cases.length === 0) {
    errors.push('Switch expression must have at least one case');
  } else {
    // Validate each case
    cases.forEach((switchCase, index) => {
      if (!switchCase || typeof switchCase !== 'object') {
        errors.push(`Case at index ${index} must be an object`);
        return;
      }

      if (!('pattern' in switchCase)) {
        errors.push(`Case at index ${index} missing required field: pattern`);
      }

      if (!('value' in switchCase)) {
        errors.push(`Case at index ${index} missing required field: value`);
      } else if (!isValidSwitchCaseValue(switchCase.value)) {
        errors.push(`Case at index ${index} value must be a string or object with 'pattern' field`);
      }
    });
  }

  // Validate default (optional, but must be valid SwitchCaseValue if provided)
  if (defaultValue !== undefined && !isValidSwitchCaseValue(defaultValue)) {
    errors.push('Switch expression default must be a string or object with \'pattern\' field');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a value is a valid SwitchCaseValue (string or FlowPattern with pattern field)
 */
function isValidSwitchCaseValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return true;
  }
  if (typeof value === 'object' && value !== null && 'pattern' in value) {
    const pattern = (value as { pattern: unknown }).pattern;
    return typeof pattern === 'string';
  }
  return false;
}
