/**
 * Map Pipeline Types
 * 
 * Type definitions for the MongoDB-inspired map transformation system.
 * Provides declarative transformations for field-level operations on documents.
 */

/**
 * Context variables available during map execution
 * Use $$ prefix to reference these in operations
 */
export interface MapContext {
  /** Filename without extension */
  filename: string;
  
  /** Parent directory name */
  dirname: string;
  
  /** Full relative path from package root */
  path: string;
  
  /** File extension (including dot) */
  ext: string;
}

/**
 * Map pipeline - array of operations executed sequentially
 */
export type MapPipeline = Operation[];

/**
 * Union type for all operations
 */
export type Operation =
  | SetOperation
  | RenameOperation
  | UnsetOperation
  | SwitchOperation
  | PipelineOperation
  | CopyOperation
  | PipeOperation;

/**
 * $set - Set field value(s)
 * 
 * Examples:
 * - { "$set": { "name": "$$filename" } }
 * - { "$set": { "name": "$$filename", "version": "1.0.0" } }
 */
export interface SetOperation {
  $set: Record<string, any>;
}

/**
 * $rename - Rename field(s)
 * 
 * Examples:
 * - { "$rename": { "oldName": "newName" } }
 * - { "$rename": { "mcp.*": "mcpServers.*" } }
 */
export interface RenameOperation {
  $rename: Record<string, string>;
}

/**
 * $unset - Remove field(s)
 * 
 * Examples:
 * - { "$unset": "permission" }
 * - { "$unset": ["permission", "legacy"] }
 */
export interface UnsetOperation {
  $unset: string | string[];
}

/**
 * $switch - Pattern matching with value replacement
 * 
 * Example:
 * {
 *   "$switch": {
 *     "field": "model",
 *     "cases": [
 *       { "pattern": "anthropic/claude-sonnet-*", "value": "sonnet" }
 *     ],
 *     "default": "inherit"
 *   }
 * }
 */
export interface SwitchOperation {
  $switch: {
    /** Field to check and replace */
    field: string;
    
    /** Pattern cases to match */
    cases: SwitchCase[];
    
    /** Default value if no pattern matches */
    default?: any;
  };
}

/**
 * Pattern case for $switch
 */
export interface SwitchCase {
  /** Pattern to match (string glob or object shape) */
  pattern: string | object;
  
  /** Value to set if pattern matches */
  value: any;
}

/**
 * $pipeline - Pipeline transformation on a field (MongoDB-inspired)
 * 
 * Renamed from $transform to better reflect MongoDB conventions.
 * Uses sub-operations with $ prefix for consistency.
 * 
 * Example:
 * {
 *   "$pipeline": {
 *     "field": "tools",
 *     "operations": [
 *       { "$filter": { "match": { "value": true } } },
 *       { "$objectToArray": { "extract": "keys" } },
 *       { "$reduce": { "type": "join", "separator": ", " } }
 *     ]
 *   }
 * }
 */
export interface PipelineOperation {
  $pipeline: {
    /** Field to transform */
    field: string;
    
    /** Pipeline operations (MongoDB-style) */
    operations: PipelineStep[];
  };
}

/**
 * Pipeline step for $pipeline operation
 * All steps use $ prefix to match MongoDB conventions
 */
export type PipelineStep =
  | FilterStep
  | ObjectToArrayStep
  | ArrayToObjectStep
  | MapStep
  | ReduceStep
  | ReplaceStep
  | PartitionStep
  | ExtractStep
  | MapValuesStep
  | MergeFieldsStep;

/**
 * $filter - Filter entries by key or value (matches MongoDB $filter)
 * 
 * Examples:
 * - { "$filter": { "match": { "value": true } } }
 * - { "$filter": { "match": { "key": "enabled" } } }
 */
export interface FilterStep {
  $filter: {
    /** Filter criteria */
    match?: {
      /** Filter by value equality */
      value?: any;
      
      /** Filter by key equality */
      key?: any;
    };
  };
}

/**
 * $objectToArray - Convert object to array (matches MongoDB $objectToArray)
 * 
 * Examples:
 * - { "$objectToArray": { "extract": "keys" } }      → ["a", "b"]
 * - { "$objectToArray": { "extract": "values" } }    → [1, 2]
 * - { "$objectToArray": { "extract": "entries" } }   → [["a", 1], ["b", 2]]
 * - { "$objectToArray": true }                       → [["a", 1], ["b", 2]] (default: entries)
 */
export interface ObjectToArrayStep {
  $objectToArray: 
    | true  // Default: extract entries
    | {
        /** What to extract from object */
        extract?: 'keys' | 'values' | 'entries';
      };
}

/**
 * $arrayToObject - Convert array to object with specified value (matches MongoDB $arrayToObject)
 * 
 * Examples:
 * - { "$arrayToObject": { "value": true } }
 *   ["bash", "read"] → { bash: true, read: true }
 * 
 * - { "$arrayToObject": { "value": "$$filename" } }
 *   ["tool1", "tool2"] → { tool1: "code-reviewer", tool2: "code-reviewer" }
 */
export interface ArrayToObjectStep {
  $arrayToObject: {
    /** Value to assign to each key (supports context variables) */
    value: any;
  };
}

/**
 * $map - Transform each element in array (matches MongoDB $map)
 * 
 * Examples:
 * - { "$map": { "each": "capitalize" } }
 * - { "$map": { "each": "uppercase" } }
 * - { "$map": { "each": "lowercase" } }
 */
export interface MapStep {
  $map: {
    /** Transformation to apply to each element */
    each: 'capitalize' | 'uppercase' | 'lowercase';
  };
}

/**
 * $reduce - Reduce array using common patterns (inspired by MongoDB $reduce)
 * 
 * Consolidates join/split and other reduction operations.
 * 
 * Examples:
 * - { "$reduce": { "type": "join", "separator": ", " } }     → "a, b, c"
 * - { "$reduce": { "type": "split", "separator": ", " } }    → ["a", "b", "c"]
 * - { "$reduce": { "type": "sum" } }                         → 6
 * - { "$reduce": { "type": "count" } }                       → 3
 */
export interface ReduceStep {
  $reduce: {
    /** Reduction strategy */
    type: 'join' | 'split' | 'sum' | 'count';
    
    /** Separator for join/split */
    separator?: string;
  };
}

/**
 * $replace - String replacement using regex (similar to MongoDB $replaceOne/$replaceAll)
 * 
 * Examples:
 * - { "$replace": { "pattern": "^anthropic/", "with": "" } }
 * - { "$replace": { "pattern": "(-[0-9]+)\\.([0-9]+)", "with": "$1-$2", "flags": "g" } }
 */
export interface ReplaceStep {
  $replace: {
    /** Regex pattern to match */
    pattern: string;
    
    /** Replacement string (supports $1, $2 capture groups) */
    with: string;
    
    /** Optional regex flags (e.g., "g", "i") */
    flags?: string;
  };
}

/**
 * $copy - Copy field with optional transformation
 * 
 * Example:
 * {
 *   "$copy": {
 *     "from": "permission",
 *     "to": "permissionMode",
 *     "transform": {
 *       "cases": [
 *         { "pattern": { "edit": "deny" }, "value": "plan" }
 *       ],
 *       "default": "default"
 *     }
 *   }
 * }
 */
export interface CopyOperation {
  $copy: {
    /** Source field path */
    from: string;
    
    /** Target field path */
    to: string;
    
    /** Optional pattern-based transformation */
    transform?: {
      /** Pattern cases */
      cases: SwitchCase[];
      
      /** Default value if no match */
      default?: any;
    };
  };
}

/**
 * $partition - Split object entries into buckets by pattern
 * 
 * Example:
 * {
 *   "$partition": {
 *     "by": "value",
 *     "patterns": {
 *       "env": "^\\$\\{env:.*\\}$",
 *       "static": ".*"
 *     }
 *   }
 * }
 */
export interface PartitionStep {
  $partition: {
    /** Partition by value or key */
    by: 'value' | 'key';
    
    /** Bucket name → regex pattern mapping */
    patterns: Record<string, string>;
  };
}

/**
 * $extract - Extract substring using regex capture groups
 * 
 * Example:
 * {
 *   "$extract": {
 *     "pattern": "^Bearer \\$\\{env:([A-Z_]+)\\}$",
 *     "group": 1,
 *     "default": "$SELF"
 *   }
 * }
 */
export interface ExtractStep {
  $extract: {
    /** Regex pattern with capture groups */
    pattern: string;
    
    /** Capture group to extract (0 = full match) */
    group: number;
    
    /** Default if no match ("$SELF" = keep original) */
    default?: string;
  };
}

/**
 * $mapValues - Apply transformation to each value in object
 * 
 * Example:
 * {
 *   "$mapValues": {
 *     "operations": [
 *       { "$extract": { "pattern": "^\\$\\{env:([A-Z_]+)\\}$", "group": 1 } }
 *     ]
 *   }
 * }
 */
export interface MapValuesStep {
  $mapValues: {
    /** Sub-pipeline to apply to each value */
    operations: PipelineStep[];
  };
}

/**
 * $mergeFields - Merge multiple fields into one
 * 
 * Example:
 * {
 *   "$mergeFields": {
 *     "from": ["http_headers", "env_http_headers"],
 *     "to": "headers"
 *   }
 * }
 */
export interface MergeFieldsStep {
  $mergeFields: {
    /** Source field names */
    from: string[];
    
    /** Target field name */
    to: string;
    
    /** Remove source fields? (default: true) */
    remove?: boolean;
  };
}

/**
 * $pipe - Apply external pipe transforms
 * 
 * Bridges map pipeline with transform registry.
 * Enables format conversions and validations within the map flow.
 * 
 * Example:
 * {
 *   "$pipe": ["filter-comments", "json-to-toml"]
 * }
 */
export interface PipeOperation {
  $pipe: string[];  // Array of transform names from registry
}

/**
 * Validation result for operations
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
