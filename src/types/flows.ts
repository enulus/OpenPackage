/**
 * Core type definitions for the Platform Flows System
 * 
 * Flows define declarative transformations for moving content between
 * universal package format and platform-specific workspace files.
 */

// ============================================================================
// Core Flow Types
// ============================================================================

/**
 * A Flow defines how to transform content from a source to a target.
 * Flows execute through a pipeline: load → extract → filter → map → transform → embed → merge → write
 */
export interface Flow {
  /** Source file pattern (supports glob patterns like *.md) */
  from: string;

  /** Target path or multi-target configuration */
  to: string | MultiTargetFlows;

  /** Transform pipeline - array of transform names to apply in order */
  pipe?: string[];

  /** Key mapping configuration - rename and transform keys */
  map?: KeyMap;

  /** Keys to include (whitelist) */
  pick?: string[];

  /** Keys to exclude (blacklist) */
  omit?: string[];

  /** JSONPath expression to extract subset of data */
  path?: string;

  /** Embed content under this key in the target */
  embed?: string;

  /** TOML section name (for TOML targets) */
  section?: string;

  /** Conditional execution */
  when?: Condition;

  /** Merge strategy when target exists (default: "replace") */
  merge?: MergeStrategy;

  /** Custom handler name for edge cases */
  handler?: string;

  /** Priority for conflict resolution (higher = wins, default: 0) */
  priority?: number;

  /** Description for documentation/debugging */
  description?: string;
}

/**
 * Multi-target flow configuration
 * Allows transforming one source to multiple targets with different transforms
 */
export interface MultiTargetFlows {
  [targetPath: string]: Partial<Flow>;
}

/**
 * Merge strategies for handling conflicts when target file exists
 */
export type MergeStrategy = 
  | "deep"          // Deep merge preserving nested structures
  | "shallow"       // Shallow merge (top-level only)
  | "replace"       // Complete replacement
  | "composite";    // Compose multiple package contributions with delimiters

// ============================================================================
// Key Mapping Types
// ============================================================================

/**
 * Key mapping configuration
 * Maps source keys to target keys with optional transformations
 */
export interface KeyMap {
  [sourceKey: string]: string | KeyMapConfig;
}

/**
 * Advanced key mapping with transformations and defaults
 */
export interface KeyMapConfig {
  /** Target key path (supports dot notation) */
  to: string;

  /** Transform to apply to the value */
  transform?: string | string[];

  /** Default value if source key is missing */
  default?: any;

  /** Value lookup table - map source values to target values */
  values?: Record<string, any>;

  /** Whether to remove the key if value is undefined/null */
  required?: boolean;
}

// ============================================================================
// Conditional Execution Types
// ============================================================================

/**
 * Conditions for flow execution
 */
export interface Condition {
  /** File or directory exists */
  exists?: string;

  /** Platform is enabled */
  platform?: string;

  /** Key exists in source data */
  key?: string;

  /** Key equals specific value */
  equals?: any;

  /** All conditions must be true */
  and?: Condition[];

  /** Any condition must be true */
  or?: Condition[];

  /** Condition must be false */
  not?: Condition;
}

// ============================================================================
// Transform Types
// ============================================================================

/**
 * Transform function interface
 */
export interface Transform {
  /** Transform name (used in pipe array) */
  name: string;

  /** Execute the transform */
  execute(input: any, options?: any, context?: TransformContext): any;

  /** Validate transform options */
  validate?(options?: any): boolean;

  /** Description for documentation */
  description?: string;

  /** Whether transform is reversible (for save flows) */
  reversible?: boolean;
}

/**
 * Context passed to transforms
 */
export interface TransformContext {
  /** Workspace root directory */
  workspaceRoot: string;

  /** Package root directory */
  packageRoot: string;

  /** Current platform ID */
  platform: string;

  /** Package name */
  packageName: string;

  /** Source file path */
  sourcePath: string;

  /** Target file path */
  targetPath: string;

  /** Custom variables */
  variables: Record<string, any>;

  /** Flow being executed */
  flow: Flow;
}

/**
 * Transform registry
 */
export interface TransformRegistry {
  /** Register a transform */
  register(transform: Transform): void;

  /** Get a transform by name */
  get(name: string): Transform | undefined;

  /** Execute a transform */
  execute(name: string, input: any, options?: any, context?: TransformContext): any;

  /** Check if transform exists */
  has(name: string): boolean;

  /** List all registered transforms */
  list(): string[];
}

// ============================================================================
// Flow Execution Types
// ============================================================================

/**
 * Flow execution context
 */
export interface FlowContext {
  /** Workspace root directory */
  workspaceRoot: string;

  /** Package root directory (in .opkg registry) */
  packageRoot: string;

  /** Current platform ID */
  platform: string;

  /** Package name */
  packageName: string;

  /** Custom variables for template substitution */
  variables: Record<string, any>;

  /** Direction: install (package→workspace) or save (workspace→package) */
  direction: "install" | "save";

  /** Dry run mode (don't write files) */
  dryRun?: boolean;
}

/**
 * Result of flow execution
 */
export interface FlowResult {
  /** Source file path */
  source: string;

  /** Target file path(s) */
  target: string | string[];

  /** Whether execution succeeded */
  success: boolean;

  /** Whether content was transformed (vs. simple copy) */
  transformed: boolean;

  /** 
   * Keys contributed by this flow (after transformations)
   * Used for precise removal during uninstall of merged files
   * Example: ["mcp.server1", "mcp.server2"]
   * Only populated when merge strategy is used
   */
  keys?: string[];

  /** Merge strategy used (if applicable) */
  merge?: 'deep' | 'shallow' | 'replace' | 'composite';

  /** Error if execution failed */
  error?: Error;

  /** Warnings encountered during execution */
  warnings?: string[];

  /** Merge conflicts detected */
  conflicts?: FlowConflict[];

  /** Transform pipeline applied */
  pipeline?: string[];

  /** Execution time in milliseconds */
  executionTime?: number;
}

/**
 * Conflict detected during merge
 */
export interface FlowConflict {
  /** Target file where conflict occurred */
  target?: string;

  /** Path where conflict occurred */
  path: string;

  /** Package that won (based on priority) */
  winner: string;

  /** Package(s) that lost */
  losers: string[];

  /** Packages involved (for platform-flows compatibility) */
  packages?: string[];

  /** Conflict type */
  type: "key" | "value" | "array" | "object";

  /** Resolution applied */
  resolution: string;

  /** Conflict details */
  details?: string;
}

// ============================================================================
// Flow Executor Interface
// ============================================================================

/**
 * Flow executor interface
 */
export interface FlowExecutor {
  /** Execute a single flow */
  executeFlow(flow: Flow, context: FlowContext): Promise<FlowResult>;

  /** Execute multiple flows */
  executeFlows(flows: Flow[], context: FlowContext): Promise<FlowResult[]>;

  /** Execute a multi-target flow */
  executeMultiTarget(flow: Flow, context: FlowContext): Promise<FlowResult[]>;

  /** Validate a flow configuration */
  validateFlow(flow: Flow): ValidationResult;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors */
  errors: ValidationError[];

  /** Validation warnings */
  warnings: ValidationWarning[];
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Error message */
  message: string;

  /** Path to the error (for nested structures) */
  path?: string;

  /** Error code */
  code?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /** Warning message */
  message: string;

  /** Path to the warning */
  path?: string;

  /** Warning code */
  code?: string;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Supported file formats
 */
export type FileFormat = 
  | "json"
  | "jsonc"
  | "yaml"
  | "yml"
  | "toml"
  | "markdown"
  | "md"
  | "text"
  | "txt";

/**
 * Content with metadata
 */
export interface ParsedContent {
  /** Parsed content */
  data: any;

  /** Original format */
  format: FileFormat;

  /** Raw content */
  raw: string;

  /** Frontmatter (for markdown) */
  frontmatter?: any;

  /** Body (for markdown) */
  body?: string;
}

/**
 * Priority calculation for conflict resolution
 */
export interface Priority {
  /** Numeric priority (higher = wins) */
  value: number;

  /** Source of priority (workspace, direct, nested) */
  source: "workspace" | "direct" | "nested";

  /** Depth in dependency tree (0 = direct) */
  depth: number;

  /** Package name */
  package: string;
}
