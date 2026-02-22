/**
 * Type definitions for Platform Flows Configuration
 * 
 * Extends the existing platform system with flow-based transformations.
 * Maintains backward compatibility with subdirs-based configuration.
 */

import type { Flow, FlowConflict } from "./flows.js"

// ============================================================================
// Platform Configuration Types
// ============================================================================

/**
 * Complete platforms configuration (platforms.jsonc)
 * Maps platform IDs to their configuration
 */
export interface PlatformsFlowsConfig {
  /** Global flows applied to all platforms */
  global?: GlobalFlowsConfig;

  /** Platform-specific configurations */
  [platformId: string]: PlatformFlowsConfig | GlobalFlowsConfig | undefined;
}

/**
 * Global flows configuration
 */
export interface GlobalFlowsConfig {
  /** Global export flows (package → workspace) applied before platform-specific flows */
  export?: Flow[];

  /** Global import flows (workspace → package) applied before platform-specific flows */
  import?: Flow[];

  /** Description */
  description?: string;
}

/**
 * Configuration for a single platform
 */
export interface PlatformFlowsConfig {
  /** Display name */
  name: string;

  /** Array of glob patterns for platform detection (e.g., ['.claude', 'CLAUDE.md']) */
  detection?: string[];

  /** Platform root directory (e.g., ".cursor", ".claude") - DEPRECATED: use detection instead */
  rootDir?: string;

  /** Optional root file for detection (e.g., "AGENTS.md") - DEPRECATED: use detection instead */
  rootFile?: string;

  /** Platform aliases for flexible naming */
  aliases?: string[];

  /** Whether platform is enabled (default: true) */
  enabled?: boolean;

  /** Export flows: Package → Workspace (install, apply) */
  export?: Flow[];

  /** Import flows: Workspace → Package (save) */
  import?: Flow[];

  /** Legacy subdirs configuration (for backward compatibility) */
  subdirs?: SubdirConfigEntry[];

  /** Description for documentation */
  description?: string;

  /** Custom variables for flow template substitution */
  variables?: Record<string, any>;
}

/**
 * Legacy subdirectory configuration entry
 * Maintained for backward compatibility during transition
 */
export interface SubdirConfigEntry {
  /** Universal directory name (e.g., "rules", "commands") */
  universalDir: string;

  /** Platform-specific directory name (e.g., "rules", "workflows") */
  platformDir: string;

  /** Allowed file extensions (undefined = all, [] = none) */
  exts?: string[];

  /** Extension transformations */
  transformations?: SubdirFileTransformation[];
}

/**
 * Extension transformation configuration
 */
export interface SubdirFileTransformation {
  /** Package (registry) extension */
  packageExt: string;

  /** Workspace extension */
  workspaceExt: string;
}

// ============================================================================
// Multi-Target Flow Types
// ============================================================================

/**
 * Multi-target flows configuration
 * Transforms one source to multiple targets with different transforms
 * Note: This is defined in flows.ts, not duplicated here
 */
// Removed: export interface MultiTargetFlows (already in flows.ts)

/**
 * Configuration for a single target in a multi-target flow
 */
export interface MultiTargetFlowConfig extends Partial<Flow> {
  /** Whether this target is enabled (default: true) */
  enabled?: boolean;

  /** Target-specific description */
  description?: string;
}

// ============================================================================
// Platform Detection and Resolution
// ============================================================================

/**
 * Platform detection result
 */
export interface PlatformDetectionResult {
  /** Platform ID */
  id: string;

  /** Platform display name */
  name: string;

  /** Whether platform was detected */
  detected: boolean;

  /** Detection method used */
  detectionMethod?: "rootDir" | "rootFile" | "both";

  /** Detected paths */
  paths?: {
    rootDir?: string;
    rootFile?: string;
  };
}

/**
 * Platform resolution result
 */
export interface PlatformResolutionResult {
  /** Platform ID */
  id: string;

  /** Platform configuration */
  config: PlatformFlowsConfig;

  /** Applicable flows for current context */
  flows: Flow[];

  /** Source of configuration (builtin, global, workspace) */
  source: "builtin" | "global" | "workspace" | "merged";
}

// ============================================================================
// Flow Execution Context
// ============================================================================

/**
 * Platform-specific flow execution context
 */
export interface PlatformFlowContext {
  /** Platform ID */
  platform: string;

  /** Platform configuration */
  config: PlatformFlowsConfig;

  /** Workspace root directory */
  workspaceRoot: string;

  /** Package root directory (in .opkg registry) */
  packageRoot: string;

  /** Package name */
  packageName: string;

  /** Flow direction */
  direction: "install" | "save" | "apply";

  /** Custom variables (merged from config and runtime) */
  variables: Record<string, any>;

  /** Dry run mode */
  dryRun?: boolean;

  /** Whether to use legacy subdirs (transition period) */
  useLegacySubdirs?: boolean;
}

// ============================================================================
// Platform Flow Mapping
// ============================================================================

/**
 * Maps workspace files to flows
 */
export interface WorkspaceFileMapping {
  /** Workspace file path (relative to workspace root) */
  workspacePath: string;

  /** Source file path (relative to package root) */
  sourcePath: string;

  /** Platform ID */
  platform: string;

  /** Flow used for transformation */
  flow: Flow;

  /** Whether file was transformed (vs. simple copy) */
  transformed: boolean;
}

/**
 * Maps package files to flows
 */
export interface PackageFileMapping {
  /** Package file path (relative to package root) */
  packagePath: string;

  /** Target file path(s) (relative to workspace root) */
  targetPaths: string[];

  /** Platform ID(s) */
  platforms: string[];

  /** Flow(s) used for transformation */
  flows: Flow[];
}

// ============================================================================
// Migration and Compatibility
// ============================================================================

/**
 * Migration result from subdirs to flows
 */
export interface SubdirsToFlowsMigration {
  /** Platform ID */
  platform: string;

  /** Generated flows */
  flows: Flow[];

  /** Warnings encountered during conversion */
  warnings: string[];

  /** Whether conversion was successful */
  success: boolean;
}

/**
 * Compatibility mode settings
 */
export interface CompatibilityMode {
  /** Support legacy subdirs format */
  supportSubdirs: boolean;

  /** Show deprecation warnings */
  showWarnings: boolean;

  /** Auto-convert subdirs to flows */
  autoConvert: boolean;

  /** Validate flows schema */
  validateFlows: boolean;
}

// ============================================================================
// Platform Flow Registry
// ============================================================================

/**
 * Platform flow registry
 * Manages flow configurations for all platforms
 */
export interface PlatformFlowRegistry {
  /** Get platform configuration */
  getConfig(platformId: string): PlatformFlowsConfig | undefined;

  /** Get flows for a platform */
  getFlows(platformId: string): Flow[];

  /** Get global flows */
  getGlobalFlows(): Flow[];

  /** Get all platforms */
  getAllPlatforms(): string[];

  /** Get enabled platforms */
  getEnabledPlatforms(): string[];

  /** Resolve platform from alias */
  resolvePlatform(alias: string): string | undefined;

  /** Detect platforms in workspace */
  detectPlatforms(workspaceRoot: string): Promise<PlatformDetectionResult[]>;

  /** Validate configuration */
  validate(): PlatformValidationResult;

  /** Migrate subdirs to flows */
  migrateSubdirs(platformId: string): SubdirsToFlowsMigration;
}

/**
 * Platform-specific validation result
 * Extends the base ValidationResult from flows.ts
 */
export interface PlatformValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors */
  errors: PlatformValidationError[];

  /** Validation warnings */
  warnings: PlatformValidationWarning[];
}

/**
 * Platform-specific validation error
 */
export interface PlatformValidationError {
  /** Platform ID (if applicable) */
  platform?: string;

  /** Flow index (if applicable) */
  flowIndex?: number;

  /** Error message */
  message: string;

  /** Path to the error */
  path?: string;

  /** Error code */
  code: string;
}

/**
 * Platform-specific validation warning
 */
export interface PlatformValidationWarning {
  /** Platform ID (if applicable) */
  platform?: string;

  /** Flow index (if applicable) */
  flowIndex?: number;

  /** Warning message */
  message: string;

  /** Path to the warning */
  path?: string;

  /** Warning code */
  code: string;
}

// ============================================================================
// Flow Execution Results
// ============================================================================

/**
 * Platform flow execution summary
 */
export interface PlatformFlowExecutionSummary {
  /** Platform ID */
  platform: string;

  /** Total flows executed */
  totalFlows: number;

  /** Successful executions */
  successful: number;

  /** Failed executions */
  failed: number;

  /** Files processed */
  filesProcessed: number;

  /** Files transformed (vs. copied) */
  filesTransformed: number;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Errors encountered */
  errors: FlowExecutionError[];

  /** Warnings */
  warnings: FlowExecutionWarning[];

  /** Conflicts resolved */
  conflicts: FlowConflict[];
}

/**
 * Flow execution error
 */
export interface FlowExecutionError {
  /** Flow that failed */
  flow: Flow;

  /** Source file */
  source: string;

  /** Target file */
  target: string;

  /** Error message */
  message: string;

  /** Stack trace */
  stack?: string;
}

/**
 * Flow execution warning
 */
export interface FlowExecutionWarning {
  /** Flow */
  flow: Flow;

  /** Source file */
  source: string;

  /** Target file */
  target: string;

  /** Warning message */
  message: string;

  /** Warning type */
  type: "deprecation" | "conflict" | "missing" | "invalid" | "other";
}

/**
 * Platform flow conflict (extends FlowConflict from flows.ts)
 * Note: FlowConflict is already defined in flows.ts
 */
// Removed: export interface FlowConflict (already in flows.ts)

// ============================================================================
// Platform Flow Statistics
// ============================================================================

/**
 * Statistics about platform flows usage
 */
export interface PlatformFlowStatistics {
  /** Total platforms */
  totalPlatforms: number;

  /** Platforms using flows */
  flowPlatforms: number;

  /** Platforms using legacy subdirs */
  subdirsPlatforms: number;

  /** Total flows defined */
  totalFlows: number;

  /** Flows by type */
  flowsByType: Record<string, number>;

  /** Most complex flows (by pipeline length) */
  complexFlows: Array<{ platform: string; flow: Flow; complexity: number }>;

  /** Coverage (% of platforms with flows) */
  coverage: number;
}
