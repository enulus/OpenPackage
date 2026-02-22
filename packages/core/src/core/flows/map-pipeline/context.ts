/**
 * Map Context Resolution
 * 
 * Resolves context variables ($$filename, $$dirname, etc.) in map operations.
 */

import type { MapContext } from './types.js';

/**
 * Resolve context variables in a value
 * 
 * Context variables use $$ prefix:
 * - $$filename → context.filename
 * - $$dirname → context.dirname
 * - $$path → context.path
 * - $$ext → context.ext
 * 
 * Literal values (no $$ prefix) are returned unchanged.
 * Escaped literal (\$$) has backslash removed to get literal "$$".
 * 
 * Examples:
 * - resolveValue("$$filename", ctx) → "my-agent"
 * - resolveValue("static-value", ctx) → "static-value"
 * - resolveValue("\\$$literal", ctx) → "$$literal"
 * - resolveValue({ name: "$$filename" }, ctx) → { name: "my-agent" }
 */
export function resolveValue(value: any, context: MapContext): any {
  // Handle strings with context variables
  if (typeof value === 'string') {
    // Check for escaped literal (\$$)
    if (value.startsWith('\\$$')) {
      return value.substring(1); // Remove escape backslash
    }

    // Check for context variable ($$)
    if (value.startsWith('$$')) {
      const varName = value.substring(2) as keyof MapContext;
      
      // Return context value if it exists
      if (varName in context) {
        return context[varName];
      }
      
      // Return original value if context variable doesn't exist
      return value;
    }

    // Literal string - return as-is
    return value;
  }

  // Handle objects - recursively resolve nested values
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map(item => resolveValue(item, context));
    }

    const result: any = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveValue(val, context);
    }
    return result;
  }

  // Return primitive values unchanged
  return value;
}

/**
 * Check if a value contains context variables
 */
export function hasContextVariables(value: any): boolean {
  if (typeof value === 'string') {
    return value.startsWith('$$') && !value.startsWith('\\$$');
  }

  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.some(item => hasContextVariables(item));
    }

    return Object.values(value).some(val => hasContextVariables(val));
  }

  return false;
}
