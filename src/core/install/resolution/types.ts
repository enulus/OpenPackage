/**
 * Types for the recursive dependency resolution system.
 * Used by graph builder, package loader, installation planner, and executor.
 */

import type { PackageYml } from '../../../types/index.js';
import type { InstallationContext } from '../unified/context.js';
import type { ResolvedPackage } from '../../dependency-resolver/types.js';
import type { InstallOptions } from '../../../types/index.js';
import type { Platform } from '../../platforms.js';
import type { VersionSolution } from './version-solver.js';

/** Parsed manifest (openpackage.yml) - alias for PackageYml */
export type ParsedManifest = PackageYml;

/**
 * Canonical identifier for a dependency that's stable across resolution.
 * Used for deduplication and cycle detection.
 */
export interface DependencyId {
  /** Computed unique key (hash of source properties) */
  key: string;
  /** Human-readable display name */
  displayName: string;
  /** Source type for this dependency */
  sourceType: 'registry' | 'path' | 'git';
}

/**
 * Raw dependency declaration as found in a manifest.
 * This is the unresolved, unparsed form directly from openpackage.yml.
 */
export interface DependencyDeclaration {
  /** Package name as declared */
  name: string;
  /** Version constraint (for registry deps) */
  version?: string;
  /** Local path (relative to declaring manifest) */
  path?: string;
  /** Git URL */
  url?: string;
  /** Git ref (branch, tag, commit) - also from url#ref */
  ref?: string;
  /** Base path override (for reproducibility) */
  base?: string;
  /** Whether this is a dev dependency */
  isDev: boolean;
  /** Path to the manifest file that declared this dependency */
  declaredIn: string;
  /** Depth in dependency tree (0 = workspace root direct deps) */
  depth: number;
}

/**
 * Resolved source with all ambiguity removed.
 * Used to load package content and build installation context.
 */
export interface ResolvedSource {
  type: 'registry' | 'path' | 'git';
  /** Registry: package name */
  packageName?: string;
  /** Registry: resolved version */
  resolvedVersion?: string;
  /** Registry: optional registry path */
  registryPath?: string;
  /** Path: absolute filesystem path */
  absolutePath?: string;
  /** Git: repository URL */
  gitUrl?: string;
  /** Git: ref (branch, tag, commit) */
  gitRef?: string;
  /** Git: resource path within repo */
  resourcePath?: string;
  /** Common: content root after loading */
  contentRoot?: string;
  /** Common: path to manifest file */
  manifestPath?: string;
}

/**
 * Base detection result (from existing base-resolver / loaders).
 */
export interface BaseDetectionResult {
  base?: string;
  relative?: string;
  source?: 'openpackage' | 'plugin' | 'marketplace' | 'pattern' | 'user-selection' | 'manifest';
  pattern?: string;
  matchType?: string;
}

/**
 * Package data after loading from source.
 */
export interface LoadedPackageData {
  /** Package name from manifest */
  name: string;
  /** Package version */
  version: string;
  /** Absolute path to content root */
  contentRoot: string;
  /** Absolute path to repo root (for git sources), when available */
  repoRoot?: string;
  /** Package metadata (PackageYml) */
  metadata: PackageYml;
  /** Parsed manifest */
  manifest: ParsedManifest;
  /** Base detection results */
  baseDetection?: BaseDetectionResult;
  /** Format detection (plugin, standard, etc.) - from loader */
  formatDetection?: { format?: unknown };
}

/**
 * Resolution state for a dependency node.
 */
export type NodeState =
  | 'pending'
  | 'discovering'
  | 'discovered'
  | 'loading'
  | 'loaded'
  | 'installing'
  | 'installed'
  | 'failed'
  | 'skipped';

/**
 * A node in the dependency graph.
 * Represents a single package with its metadata and resolution state.
 */
export interface ResolutionDependencyNode {
  /** Unique identifier */
  id: DependencyId;
  /** Original declaration(s) that led to this node */
  declarations: DependencyDeclaration[];
  /** Resolved source information */
  source: ResolvedSource;
  /** Children (dependencies of this package) */
  children: DependencyId[];
  /** Parents (packages that depend on this) */
  parents: DependencyId[];
  /** Resolution state */
  state: NodeState;
  /** Loaded package data (populated in Phase 2) */
  loaded?: LoadedPackageData;
  /** Installation context (populated in Phase 3) */
  installContext?: InstallationContext;
}

/**
 * Detected cycle in the dependency graph.
 */
export interface DependencyCycle {
  /** Nodes involved in the cycle */
  nodes: DependencyId[];
  /** How the cycle was resolved */
  resolution: 'skipped' | 'error' | 'ignored';
}

/**
 * Graph metadata.
 */
export interface GraphMetadata {
  /** When graph was built */
  builtAt: Date;
  /** Workspace root */
  workspaceRoot: string;
  /** Total node count */
  nodeCount: number;
  /** Maximum depth */
  maxDepth: number;
  /** Warnings accumulated during discovery */
  warnings: string[];
}

/**
 * The complete dependency graph.
 */
export interface DependencyGraph {
  /** All nodes keyed by their unique ID */
  nodes: Map<string, ResolutionDependencyNode>;
  /** Root node IDs - entry points */
  roots: DependencyId[];
  /** Topologically sorted installation order */
  installationOrder: DependencyId[];
  /** Detected cycles */
  cycles: DependencyCycle[];
  /** Graph metadata */
  metadata: GraphMetadata;
}

/**
 * A package skipped during planning.
 */
export interface SkippedPackage {
  id: DependencyId;
  reason: 'not-loaded' | 'already-installed' | 'cycle' | 'failed';
}

/**
 * Installation plan produced by the planner.
 */
export interface InstallationPlan {
  /** Contexts to install, in order */
  contexts: InstallationContext[];
  /** Packages skipped and why */
  skipped: SkippedPackage[];
  /** The graph this plan was built from */
  graph: DependencyGraph;
  /** Estimated operations (for reporting) */
  estimatedOperations?: number;
}

/**
 * Options for the graph builder.
 */
export interface GraphBuilderOptions {
  /** Include dev-dependencies at workspace root level */
  includeDev?: boolean;
  /** Maximum recursion depth */
  maxDepth?: number;
  /** Workspace root directory (cwd for path resolution when using workspace manifest) */
  workspaceRoot: string;
  /**
   * Optional root manifest path. When set, the graph is built from this manifest
   * instead of workspace .openpackage/openpackage.yml. Path resolution for root-level
   * deps uses dirname(rootManifestPath).
   */
  rootManifestPath?: string;
  /**
   * When true, include the root manifest package itself as a node in the graph.
   * This makes the executor install the root package along with its dependencies
   * in a single unified flow. Default: false.
   */
  includeRoot?: boolean;
  /** Skip git cache (for --remote flag) */
  skipCache?: boolean;
}

/**
 * Options for the package loader.
 */
export interface PackageLoaderOptions {
  /** Enable parallel loading for same-depth nodes */
  parallel?: boolean;
  /** Enable in-memory cache of loaded packages */
  cacheEnabled?: boolean;
  /** Install options passed to source loaders */
  installOptions?: InstallOptions;
}

/**
 * Options for the installation planner.
 */
export interface InstallationPlannerOptions {
  /** Resolved platforms (shared across all packages) */
  platforms: Platform[];
  /** Install options */
  installOptions: InstallOptions;
  /** Force reinstall even if already installed */
  force?: boolean;
}

/**
 * Options for the dependency resolution executor.
 */
export interface ExecutorOptions {
  /** Graph builder options */
  graphOptions: GraphBuilderOptions;
  /** Package loader options */
  loaderOptions: PackageLoaderOptions;
  /** Installation planner options */
  plannerOptions: InstallationPlannerOptions;
  /** Dry run: stop after planning, do not install */
  dryRun?: boolean;
  /** Fail on first installation failure */
  failFast?: boolean;
}

/**
 * Result for a single package installation.
 */
export interface PackageResult {
  id: DependencyId;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Summary of execution.
 */
export interface ExecutionSummary {
  total: number;
  installed: number;
  failed: number;
  skipped: number;
}

/**
 * Result of running the dependency resolution executor.
 */
export interface ExecutionResult {
  /** Whether all packages installed successfully */
  success: boolean;
  /** Error message if overall failure */
  error?: string;
  /** Per-package results */
  results: PackageResult[];
  /** Summary counts */
  summary?: ExecutionSummary;
  /** The dependency graph (for debugging/reporting) */
  graph?: DependencyGraph;
  /** Warnings accumulated during execution */
  warnings?: string[];
  /** Version solution from semver constraint resolution */
  versionSolution?: VersionSolution;
}
