/**
 * Map Pipeline
 * 
 * MongoDB-inspired document transformation pipeline.
 * Executes operations sequentially on documents.
 */

import type { MapPipeline, MapContext, Operation, ValidationResult } from './types.js';
import type { TransformRegistry } from '../flow-transforms.js';
import { deepClone } from './utils.js';
import { executeSet, validateSet } from './operations/set.js';
import { executeRename, validateRename } from './operations/rename.js';
import { executeUnset, validateUnset } from './operations/unset.js';
import { executeSwitch, validateSwitch } from './operations/switch.js';
import { executePipeline, validatePipeline } from './operations/transform.js';
import { executeCopy, validateCopy } from './operations/copy.js';
import { executePipe, validatePipe } from './operations/pipe.js';

/**
 * Apply map pipeline to a document
 * 
 * Executes operations sequentially, passing the result of each operation
 * to the next operation in the pipeline.
 * 
 * @param document - Input document to transform
 * @param pipeline - Array of operations to apply
 * @param context - Context for variable resolution
 * @param transformRegistry - Optional transform registry for $pipe operations
 * @returns Transformed document
 */
export function applyMapPipeline(
  document: any,
  pipeline: MapPipeline,
  context: MapContext,
  transformRegistry?: TransformRegistry
): any {
  // Start with a deep clone to avoid mutating input
  let result = deepClone(document);

  // Execute each operation in sequence
  for (const operation of pipeline) {
    result = executeOperation(result, operation, context, transformRegistry);
  }

  return result;
}

/**
 * Execute a single operation
 */
function executeOperation(
  document: any,
  operation: Operation,
  context: MapContext,
  transformRegistry?: TransformRegistry
): any {
  if ('$set' in operation) {
    return executeSet(document, operation, context);
  }

  if ('$rename' in operation) {
    return executeRename(document, operation);
  }

  if ('$unset' in operation) {
    return executeUnset(document, operation);
  }

  if ('$switch' in operation) {
    return executeSwitch(document, operation);
  }

  if ('$pipeline' in operation) {
    return executePipeline(document, operation, context);
  }

  if ('$copy' in operation) {
    return executeCopy(document, operation);
  }

  if ('$pipe' in operation) {
    if (!transformRegistry) {
      throw new Error('$pipe operation requires transform registry to be provided');
    }
    return executePipe(document, operation, transformRegistry);
  }

  // Unknown operation - return document unchanged
  return document;
}

/**
 * Validate a map pipeline
 * 
 * Checks all operations for validity before execution.
 */
export function validateMapPipeline(pipeline: MapPipeline): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(pipeline)) {
    return {
      valid: false,
      errors: ['Map pipeline must be an array'],
    };
  }

  if (pipeline.length === 0) {
    return {
      valid: false,
      errors: ['Map pipeline must have at least one operation'],
    };
  }

  for (let i = 0; i < pipeline.length; i++) {
    const operation = pipeline[i];
    
    if (!operation || typeof operation !== 'object') {
      errors.push(`Operation at index ${i} must be an object`);
      continue;
    }

    // Check that operation has exactly one operation key
    const operationKeys = Object.keys(operation);
    const validOperations = ['$set', '$rename', '$unset', '$switch', '$pipeline', '$copy', '$pipe'];
    const operationKey = operationKeys.find(key => validOperations.includes(key));

    if (!operationKey) {
      errors.push(
        `Operation at index ${i} must have one of: ${validOperations.join(', ')}`
      );
      continue;
    }

    if (operationKeys.length > 1) {
      errors.push(
        `Operation at index ${i} must have exactly one operation (found: ${operationKeys.join(', ')})`
      );
      continue;
    }

    // Validate specific operation
    const validation = validateOperation(operation);
    if (!validation.valid) {
      errors.push(
        `Operation at index ${i} (${operationKey}): ${validation.errors.join(', ')}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single operation
 */
function validateOperation(operation: Operation): ValidationResult {
  if ('$set' in operation) {
    return validateSet(operation);
  }

  if ('$rename' in operation) {
    return validateRename(operation);
  }

  if ('$unset' in operation) {
    return validateUnset(operation);
  }

  if ('$switch' in operation) {
    return validateSwitch(operation);
  }

  if ('$pipeline' in operation) {
    return validatePipeline(operation);
  }

  if ('$copy' in operation) {
    return validateCopy(operation);
  }

  if ('$pipe' in operation) {
    return validatePipe(operation);
  }

  return {
    valid: false,
    errors: ['Unknown operation type'],
  };
}

/**
 * Split a map pipeline into schema operations and pipe operations.
 *
 * Convention:
 * - schema ops (everything except $pipe) operate on structured data
 * - $pipe ops can convert formats (e.g., json-to-toml) and are often applied later
 */
export function splitMapPipeline(pipeline: MapPipeline): { schemaOps: MapPipeline; pipeOps: MapPipeline } {
  const schemaOps: MapPipeline = [];
  const pipeOps: MapPipeline = [];

  for (const op of pipeline) {
    if (op && typeof op === 'object' && '$pipe' in op) {
      pipeOps.push(op);
    } else {
      schemaOps.push(op);
    }
  }

  return { schemaOps, pipeOps };
}

/**
 * Create a map context from file information
 */
export function createMapContext(options: {
  filename: string;
  dirname: string;
  path: string;
  ext: string;
}): MapContext {
  return {
    filename: options.filename,
    dirname: options.dirname,
    path: options.path,
    ext: options.ext,
  };
}
