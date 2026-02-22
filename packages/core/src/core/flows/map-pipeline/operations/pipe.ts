/**
 * $pipe Operation
 * 
 * Applies external pipe transforms within the map pipeline.
 * Enables interleaving format conversions with schema transformations.
 * 
 * This operation bridges the map pipeline (document transformations)
 * with the transform registry (format conversions, validations).
 */

import type { PipeOperation } from '../types.js';
import type { TransformRegistry } from '../../flow-transforms.js';

/**
 * Execute $pipe operation
 * 
 * Applies a sequence of transforms from the transform registry.
 * 
 * Example:
 * {
 *   "$pipe": ["filter-comments", "json-to-toml"]
 * }
 * 
 * @param document - Input document
 * @param operation - Pipe operation configuration
 * @param transformRegistry - Transform registry to execute transforms from
 * @returns Transformed document
 */
export function executePipe(
  document: any,
  operation: PipeOperation,
  transformRegistry: TransformRegistry
): any {
  let result = document;

  // Apply each transform sequentially
  for (const transformName of operation.$pipe) {
    try {
      result = transformRegistry.execute(transformName, result);
    } catch (error) {
      throw new Error(
        `$pipe transform '${transformName}' failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return result;
}

/**
 * Validate $pipe operation
 * 
 * Ensures the pipe configuration is valid.
 */
export function validatePipe(operation: PipeOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!operation.$pipe) {
    errors.push('$pipe must be defined');
    return { valid: false, errors };
  }

  if (!Array.isArray(operation.$pipe)) {
    errors.push('$pipe must be an array of transform names');
    return { valid: false, errors };
  }

  if (operation.$pipe.length === 0) {
    errors.push('$pipe must have at least one transform');
  }

  for (let i = 0; i < operation.$pipe.length; i++) {
    const transformName = operation.$pipe[i];
    
    if (typeof transformName !== 'string') {
      errors.push(`$pipe[${i}] must be a string (transform name)`);
    } else if (!transformName || transformName.trim() === '') {
      errors.push(`$pipe[${i}] transform name cannot be empty`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
