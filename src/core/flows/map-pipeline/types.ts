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
  | TransformOperation
  | CopyOperation;

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
 * $transform - Pipeline transformation on a field
 * 
 * Example:
 * {
 *   "$transform": {
 *     "field": "tools",
 *     "steps": [
 *       { "filter": { "value": true } },
 *       { "keys": true },
 *       { "join": ", " }
 *     ]
 *   }
 * }
 */
export interface TransformOperation {
  $transform: {
    /** Field to transform */
    field: string;
    
    /** Transformation steps */
    steps: TransformStep[];
  };
}

/**
 * Transform step for $transform operation
 */
export type TransformStep =
  | FilterStep
  | KeysStep
  | ValuesStep
  | EntriesStep
  | MapStep
  | JoinStep;

/**
 * Filter entries by key or value
 */
export interface FilterStep {
  filter: {
    /** Filter by value equality */
    value?: any;
    
    /** Filter by key equality */
    key?: any;
  };
}

/**
 * Extract object keys to array
 */
export interface KeysStep {
  keys: true;
}

/**
 * Extract object values to array
 */
export interface ValuesStep {
  values: true;
}

/**
 * Convert object to entries array [[key, value], ...]
 */
export interface EntriesStep {
  entries: true;
}

/**
 * Map transform on each array element
 */
export interface MapStep {
  map: 'capitalize' | 'uppercase' | 'lowercase';
}

/**
 * Join array to string
 */
export interface JoinStep {
  join: string;
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
 * Validation result for operations
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
