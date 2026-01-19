/**
 * $pipeline Operation (MongoDB-aligned)
 * 
 * Pipeline transformation on a field.
 * Renamed from $transform for better MongoDB alignment.
 * All sub-operations now use $ prefix.
 */

import type { PipelineOperation, PipelineStep, MapContext } from '../types.js';
import { getNestedValue, setNestedValue, deleteNestedValue, resolveWildcardPaths } from '../utils.js';
import { resolveValue } from '../context.js';

/**
 * Execute $pipeline operation
 * 
 * Supports wildcard paths for batch transformations.
 */
export function executePipeline(
  document: any,
  operation: PipelineOperation,
  context: MapContext
): any {
  const result = { ...document };
  const { field, operations } = operation.$pipeline;

  // Check if field contains wildcard
  const hasWildcard = field.includes('*');

  if (hasWildcard) {
    // Wildcard mode: resolve all matching paths
    const matchedPaths = resolveWildcardPaths(result, field);

    if (matchedPaths.length === 0) {
      return result;
    }

    // Apply pipeline to each matched path independently
    for (const path of matchedPaths) {
      let value = getNestedValue(result, path);

      for (const step of operations) {
        value = applyPipelineStep(value, step, context);
      }

      if (value === '' || (Array.isArray(value) && value.length === 0)) {
        deleteNestedValue(result, path);
      } else {
        setNestedValue(result, path, value);
      }
    }
  } else {
    // Single field mode
    let value = getNestedValue(result, field);

    for (const step of operations) {
      value = applyPipelineStep(value, step, context);
    }

    if (value === '' || (Array.isArray(value) && value.length === 0)) {
      deleteNestedValue(result, field);
    } else {
      setNestedValue(result, field, value);
    }
  }

  return result;
}

/**
 * Apply a single pipeline step
 */
function applyPipelineStep(value: any, step: PipelineStep, context: MapContext): any {
  if ('$filter' in step) {
    return applyFilter(value, step.$filter);
  }

  if ('$objectToArray' in step) {
    return applyObjectToArray(value, step.$objectToArray);
  }

  if ('$arrayToObject' in step) {
    return applyArrayToObject(value, step.$arrayToObject, context);
  }

  if ('$map' in step) {
    return applyMap(value, step.$map);
  }

  if ('$reduce' in step) {
    return applyReduce(value, step.$reduce);
  }

  if ('$replace' in step) {
    return applyReplace(value, step.$replace);
  }

  if ('$partition' in step) {
    return applyPartition(value, step.$partition);
  }

  if ('$extract' in step) {
    return applyExtract(value, step.$extract);
  }

  if ('$mapValues' in step) {
    return applyMapValues(value, step.$mapValues, context);
  }

  if ('$mergeFields' in step) {
    return applyMergeFields(value, step.$mergeFields);
  }

  // Unknown step - return unchanged
  return value;
}

/**
 * $filter step: { "$filter": { "match": { "value": true } } }
 * Keeps entries where value or key matches
 * Matches MongoDB $filter semantics
 */
function applyFilter(value: any, config: { match?: { value?: any; key?: any } }): any {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const result: any = {};
  const match = config.match || {};

  for (const [key, val] of Object.entries(value)) {
    let keep = true;

    // Filter by value
    if ('value' in match && val !== match.value) {
      keep = false;
    }

    // Filter by key
    if ('key' in match && key !== match.key) {
      keep = false;
    }

    if (keep) {
      result[key] = val;
    }
  }

  return result;
}

/**
 * $objectToArray step (matches MongoDB $objectToArray)
 * 
 * Examples:
 * - { "$objectToArray": { "extract": "keys" } }      → ["a", "b"]
 * - { "$objectToArray": { "extract": "values" } }    → [1, 2]
 * - { "$objectToArray": { "extract": "entries" } }   → [["a", 1], ["b", 2]]
 * - { "$objectToArray": true }                       → [["a", 1], ["b", 2]] (default)
 */
function applyObjectToArray(
  value: any, 
  config: true | { extract?: 'keys' | 'values' | 'entries' }
): any {
  if (typeof value !== 'object' || value === null) {
    return [];
  }

  // Handle boolean shorthand
  if (config === true) {
    return Object.entries(value);
  }

  const extract = config.extract || 'entries';

  switch (extract) {
    case 'keys':
      return Object.keys(value);
    case 'values':
      return Object.values(value);
    case 'entries':
      return Object.entries(value);
    default:
      return Object.entries(value);
  }
}

/**
 * $arrayToObject step (matches MongoDB $arrayToObject)
 * Convert array of strings to object with specified value
 * 
 * Examples:
 * - { "$arrayToObject": { "value": true } }
 *   ["bash", "read"] → { bash: true, read: true }
 * 
 * - { "$arrayToObject": { "value": "$$filename" } }
 *   ["tool1", "tool2"] → { tool1: "code-reviewer", tool2: "code-reviewer" }
 */
function applyArrayToObject(value: any, config: { value: any }, context: MapContext): any {
  if (!Array.isArray(value)) {
    return value;
  }

  // Resolve context variables in the value
  const resolvedValue = resolveValue(config.value, context);

  const result: any = {};
  for (const key of value) {
    if (typeof key === 'string') {
      result[key] = resolvedValue;
    }
  }

  return result;
}

/**
 * $map step (inspired by MongoDB $map)
 * Transform each element in array
 * 
 * Examples:
 * - { "$map": { "each": "capitalize" } }        // String transformation
 * - { "$map": { "each": "uppercase" } }
 * - { "$map": { "each": "lowercase" } }
 * - { "$map": { "replace": { "old": "new" } } } // Value replacement using lookup table
 */
function applyMap(
  value: any, 
  config: { each?: 'capitalize' | 'uppercase' | 'lowercase'; replace?: Record<string, string> }
): any {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map(item => {
    if (typeof item !== 'string') {
      return item;
    }

    // Replace mode: lookup-based value replacement
    if (config.replace) {
      return config.replace[item] || item;  // Return mapped value or original if not found
    }

    // Each mode: string transformation
    if (config.each) {
      switch (config.each) {
        case 'capitalize':
          return item.charAt(0).toUpperCase() + item.slice(1);
        case 'uppercase':
          return item.toUpperCase();
        case 'lowercase':
          return item.toLowerCase();
        default:
          return item;
      }
    }

    // No transformation specified
    return item;
  });
}

/**
 * $reduce step (inspired by MongoDB $reduce)
 * Reduces array using common patterns
 * 
 * Examples:
 * - { "$reduce": { "type": "join", "separator": ", " } }   → "a, b, c"
 * - { "$reduce": { "type": "split", "separator": ", " } }  → ["a", "b", "c"]
 * - { "$reduce": { "type": "sum" } }                       → 6
 * - { "$reduce": { "type": "count" } }                     → 3
 */
function applyReduce(
  value: any, 
  config: { type: 'join' | 'split' | 'sum' | 'count'; separator?: string }
): any {
  const { type, separator = '' } = config;

  switch (type) {
    case 'join':
      // Join array to string
      if (!Array.isArray(value)) {
        return value;
      }
      return value.join(separator);

    case 'split':
      // Split string to array (inverse of join)
      if (typeof value !== 'string') {
        return value;
      }
      return value.split(separator).map(s => s.trim()).filter(s => s.length > 0);

    case 'sum':
      // Sum array of numbers
      if (!Array.isArray(value)) {
        return value;
      }
      return value.reduce((sum, n) => sum + (Number(n) || 0), 0);

    case 'count':
      // Count array elements
      if (!Array.isArray(value)) {
        return 0;
      }
      return value.length;

    default:
      return value;
  }
}

/**
 * $replace step (similar to MongoDB $replaceOne/$replaceAll)
 * String replacement using regex with capture group support
 * 
 * Examples:
 * - { "$replace": { "pattern": "^anthropic/", "with": "" } }
 *   "anthropic/claude-sonnet" → "claude-sonnet"
 * 
 * - { "$replace": { "pattern": "(-[0-9]+)\\.([0-9]+)", "with": "$1-$2", "flags": "g" } }
 *   "claude-4.5" → "claude-4-5"
 * 
 * - { "$replace": { "pattern": "^(.*)$", "with": "anthropic/$1" } }
 *   "claude-sonnet" → "anthropic/claude-sonnet"
 */
function applyReplace(
  value: any, 
  config: { pattern: string; with: string; flags?: string }
): any {
  if (typeof value !== 'string') {
    return value;
  }

  const flags = config.flags || '';
  const regex = new RegExp(config.pattern, flags);
  
  return value.replace(regex, config.with);
}

// ============================================================================
// New Atomic Operations
// ============================================================================

/**
 * $partition step - Split object entries into buckets by pattern
 */
function applyPartition(
  value: any,
  config: { by: 'value' | 'key'; patterns: Record<string, string> }
): any {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const result: Record<string, any> = {};

  for (const [entryKey, entryValue] of Object.entries(value)) {
    const testValue = config.by === 'value' ? String(entryValue) : entryKey;
    
    for (const [bucketName, pattern] of Object.entries(config.patterns)) {
      const regex = new RegExp(pattern);
      if (regex.test(testValue)) {
        // Only create bucket if it doesn't exist yet
        if (!result[bucketName]) {
          result[bucketName] = {};
        }
        result[bucketName][entryKey] = entryValue;
        break;
      }
    }
  }

  return result;
}

/**
 * $extract step - Extract substring using regex capture groups
 */
function applyExtract(
  value: any,
  config: { pattern: string; group: number; default?: string }
): any {
  if (typeof value !== 'string') {
    return value;
  }

  const regex = new RegExp(config.pattern);
  const match = value.match(regex);
  
  if (!match) {
    if (config.default === '$SELF') {
      return value;
    }
    return config.default !== undefined ? config.default : value;
  }

  return match[config.group];
}

/**
 * $mapValues step - Apply transformation to each value in object
 */
function applyMapValues(
  value: any,
  config: { operations: PipelineStep[] },
  context: MapContext
): any {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const result: any = {};
  
  for (const [key, val] of Object.entries(value)) {
    let transformedValue = val;
    
    for (const step of config.operations) {
      transformedValue = applyPipelineStep(transformedValue, step, context);
    }
    
    result[key] = transformedValue;
  }

  return result;
}

/**
 * $mergeFields step - Merge multiple fields into one
 */
function applyMergeFields(
  value: any,
  config: { from: string[]; to: string; remove?: boolean }
): any {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const result = { ...value };
  const merged: any = {};

  for (const sourceKey of config.from) {
    if (sourceKey in result) {
      const sourceValue = result[sourceKey];
      if (typeof sourceValue === 'object' && sourceValue !== null) {
        Object.assign(merged, sourceValue);
      }
      
      if (config.remove !== false) {
        delete result[sourceKey];
      }
    }
  }

  if (Object.keys(merged).length > 0) {
    result[config.to] = merged;
  }

  return result;
}

/**
 * Validate $pipeline operation
 */
export function validatePipeline(operation: PipelineOperation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!operation.$pipeline || typeof operation.$pipeline !== 'object') {
    errors.push('$pipeline must be an object');
    return { valid: false, errors };
  }

  const config = operation.$pipeline;

  if (!config.field || typeof config.field !== 'string') {
    errors.push('$pipeline.field must be a non-empty string');
  }

  if (!config.operations || !Array.isArray(config.operations)) {
    errors.push('$pipeline.operations must be an array');
    return { valid: errors.length === 0, errors };
  }

  if (config.operations.length === 0) {
    errors.push('$pipeline.operations must have at least one operation');
  }

  for (let i = 0; i < config.operations.length; i++) {
    const step = config.operations[i];
    
    if (!step || typeof step !== 'object') {
      errors.push(`$pipeline.operations[${i}] must be an object`);
      continue;
    }

    const stepKeys = Object.keys(step);
    if (stepKeys.length !== 1) {
      errors.push(`$pipeline.operations[${i}] must have exactly one operation`);
      continue;
    }

    const operation = stepKeys[0];
    const validOps = [
      '$filter', 
      '$objectToArray', 
      '$arrayToObject', 
      '$map', 
      '$reduce', 
      '$replace',
      '$partition',
      '$extract',
      '$mapValues',
      '$mergeFields'
    ];
    
    if (!validOps.includes(operation)) {
      errors.push(
        `$pipeline.operations[${i}] has unknown operation "${operation}". ` +
        `Valid: ${validOps.join(', ')}`
      );
    }

    // Validate specific operations
    if (operation === '$filter') {
      const filterConfig = (step as any).$filter;
      if (filterConfig && typeof filterConfig === 'object' && filterConfig.match) {
        const match = filterConfig.match;
        if (typeof match !== 'object') {
          errors.push(`$pipeline.operations[${i}].$filter.match must be an object`);
        }
      }
    }

    if (operation === '$objectToArray') {
      const config = (step as any).$objectToArray;
      if (config !== true && typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$objectToArray must be true or an object`);
      } else if (typeof config === 'object' && config.extract) {
        const validExtracts = ['keys', 'values', 'entries'];
        if (!validExtracts.includes(config.extract)) {
          errors.push(
            `$pipeline.operations[${i}].$objectToArray.extract must be one of: ${validExtracts.join(', ')}`
          );
        }
      }
    }

    if (operation === '$arrayToObject') {
      const config = (step as any).$arrayToObject;
      if (!config || typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$arrayToObject must be an object`);
      } else if (!('value' in config)) {
        errors.push(`$pipeline.operations[${i}].$arrayToObject must have a 'value' property`);
      }
    }

    if (operation === '$map') {
      const config = (step as any).$map;
      if (!config || typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$map must be an object`);
      } else {
        const hasEach = 'each' in config;
        const hasReplace = 'replace' in config;
        
        // Must have either 'each' or 'replace', but not both
        if (!hasEach && !hasReplace) {
          errors.push(`$pipeline.operations[${i}].$map must have either 'each' or 'replace' property`);
        } else if (hasEach && hasReplace) {
          errors.push(`$pipeline.operations[${i}].$map cannot have both 'each' and 'replace' properties`);
        } else if (hasEach) {
          // Validate 'each' mode (string transformations)
          const validMaps = ['capitalize', 'uppercase', 'lowercase'];
          if (!validMaps.includes(config.each)) {
            errors.push(
              `$pipeline.operations[${i}].$map.each must be one of: ${validMaps.join(', ')}`
            );
          }
        } else if (hasReplace) {
          // Validate 'replace' mode (lookup table)
          if (typeof config.replace !== 'object' || config.replace === null || Array.isArray(config.replace)) {
            errors.push(`$pipeline.operations[${i}].$map.replace must be an object (lookup table)`);
          } else if (Object.keys(config.replace).length === 0) {
            errors.push(`$pipeline.operations[${i}].$map.replace must have at least one mapping`);
          }
        }
      }
    }

    if (operation === '$reduce') {
      const config = (step as any).$reduce;
      if (!config || typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$reduce must be an object`);
      } else if (!config.type) {
        errors.push(`$pipeline.operations[${i}].$reduce must have a 'type' property`);
      } else {
        const validTypes = ['join', 'split', 'sum', 'count'];
        if (!validTypes.includes(config.type)) {
          errors.push(
            `$pipeline.operations[${i}].$reduce.type must be one of: ${validTypes.join(', ')}`
          );
        }
        if ((config.type === 'join' || config.type === 'split') && config.separator !== undefined && typeof config.separator !== 'string') {
          errors.push(`$pipeline.operations[${i}].$reduce.separator must be a string`);
        }
      }
    }

    if (operation === '$replace') {
      const config = (step as any).$replace;
      if (!config || typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$replace must be an object`);
      } else {
        if (typeof config.pattern !== 'string') {
          errors.push(`$pipeline.operations[${i}].$replace.pattern must be a string`);
        }
        if (typeof config.with !== 'string') {
          errors.push(`$pipeline.operations[${i}].$replace.with must be a string`);
        }
        if (config.flags !== undefined && typeof config.flags !== 'string') {
          errors.push(`$pipeline.operations[${i}].$replace.flags must be a string`);
        }
      }
    }

    if (operation === '$partition') {
      const config = (step as any).$partition;
      if (!config || typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$partition must be an object`);
      } else {
        if (!config.by || !['value', 'key'].includes(config.by)) {
          errors.push(`$pipeline.operations[${i}].$partition.by must be "value" or "key"`);
        }
        if (!config.patterns || typeof config.patterns !== 'object') {
          errors.push(`$pipeline.operations[${i}].$partition.patterns must be an object`);
        } else if (Object.keys(config.patterns).length === 0) {
          errors.push(`$pipeline.operations[${i}].$partition.patterns must have at least one pattern`);
        }
      }
    }

    if (operation === '$extract') {
      const config = (step as any).$extract;
      if (!config || typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$extract must be an object`);
      } else {
        if (typeof config.pattern !== 'string') {
          errors.push(`$pipeline.operations[${i}].$extract.pattern must be a string`);
        }
        if (typeof config.group !== 'number') {
          errors.push(`$pipeline.operations[${i}].$extract.group must be a number`);
        }
      }
    }

    if (operation === '$mapValues') {
      const config = (step as any).$mapValues;
      if (!config || typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$mapValues must be an object`);
      } else if (!Array.isArray(config.operations)) {
        errors.push(`$pipeline.operations[${i}].$mapValues.operations must be an array`);
      } else if (config.operations.length === 0) {
        errors.push(`$pipeline.operations[${i}].$mapValues.operations must have at least one operation`);
      }
    }

    if (operation === '$mergeFields') {
      const config = (step as any).$mergeFields;
      if (!config || typeof config !== 'object') {
        errors.push(`$pipeline.operations[${i}].$mergeFields must be an object`);
      } else {
        if (!Array.isArray(config.from) || config.from.length === 0) {
          errors.push(`$pipeline.operations[${i}].$mergeFields.from must be a non-empty array`);
        }
        if (typeof config.to !== 'string') {
          errors.push(`$pipeline.operations[${i}].$mergeFields.to must be a string`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
