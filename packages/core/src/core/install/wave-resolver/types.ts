/**
 * Types for the wave-based BFS dependency resolver.
 * Used by wave-engine, fetcher, version-solver, context-builder, and index-updater.
 */

import type { PackageYml } from '../../../types/index.js';
import type { InstallResolutionMode } from '../types.js';
import type { Platform } from '../../platforms.js';
import type { InstallOptions } from '../../../types/index.js';

// ---------------------------------------------------------------------------
// Types migrated from resolution/types.ts to remove cross-module dependency
// ---------------------------------------------------------------------------

/** Parsed manifest (openpackage.yml) - alias for PackageYml */
export type ParsedManifest = PackageYml;

export interface DependencyDeclaration {
  name: string;
  version?: string;
  path?: string;
  url?: string;
  ref?: string;
  base?: string;
  isDev: boolean;
  declaredIn: string;
  depth: number;
}

export interface ResolvedSource {
  type: 'registry' | 'path' | 'git';
  packageName?: string;
  resolvedVersion?: string;
  registryPath?: string;
  absolutePath?: string;
  gitUrl?: string;
  gitRef?: string;
  resourcePath?: string;
  contentRoot?: string;
  manifestPath?: string;
}

export interface BaseDetectionResult {
  base?: string;
  relative?: string;
  source?: 'openpackage' | 'plugin' | 'marketplace' | 'pattern' | 'user-selection' | 'manifest';
  pattern?: string;
  matchType?: string;
}

export interface LoadedPackageData {
  name: string;
  version: string;
  contentRoot: string;
  repoRoot?: string;
  metadata: PackageYml;
  manifest: ParsedManifest;
  baseDetection?: BaseDetectionResult;
  formatDetection?: { format?: unknown };
}

/**
 * A resolved dependency node in the wave graph.
 */
export interface WaveNode {
  /** Canonical key (e.g. 'registry:react', 'git:url#ref:path', 'path:/abs/path') */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Source type for this dependency */
  sourceType: 'registry' | 'path' | 'git';
  /** Full resolved source information */
  source: ResolvedSource;
  /** All declarations that led to this node (may have multiple parents) */
  declarations: DependencyDeclaration[];
  /** Resolved version (picked by the version solver for registry deps) */
  resolvedVersion?: string;
  /** Filesystem path to package content */
  contentRoot?: string;
  /** For git sources, the repository root path */
  repoRoot?: string;
  /** Parsed package manifest */
  metadata?: PackageYml;
  /** Child node IDs (dependencies of this package) */
  children: string[];
  /** Parent node IDs (packages that depend on this) */
  parents: string[];
  /** Which wave resolved this node */
  wave: number;
  /** Whether this is a marketplace (excluded from recursive resolution) */
  isMarketplace?: boolean;
  /** Loaded package data (populated for path/git; left undefined for registry nodes) */
  loaded?: LoadedPackageData;
}

/**
 * The complete resolved dependency graph produced by the wave engine.
 */
export interface WaveGraph {
  /** All resolved nodes keyed by canonical ID */
  nodes: Map<string, WaveNode>;
  /** Root node IDs (entry points) */
  roots: string[];
  /** Topologically sorted install order (leaves first) */
  installOrder: string[];
  /** Detected dependency cycles (arrays of node IDs) */
  cycles: string[][];
  /** Total number of waves executed */
  waveCount: number;
  /** Warnings accumulated during resolution */
  warnings: string[];
}

/**
 * Return type of resolveWave().
 */
export interface WaveResult {
  /** The resolved dependency graph */
  graph: WaveGraph;
  /** Version solution from constraint resolution */
  versionSolution: WaveVersionSolution;
}

/**
 * Output from the version solver.
 */
export interface WaveVersionSolution {
  /** Package name to resolved version */
  resolved: Map<string, string>;
  /** Conflicts that could not be resolved */
  conflicts: WaveVersionConflict[];
}

/**
 * A version conflict encountered during solving.
 */
export interface WaveVersionConflict {
  /** Package name with conflicting constraints */
  packageName: string;
  /** All semver ranges requested */
  ranges: string[];
  /** Which manifests requested each range */
  requestedBy: string[];
}

/**
 * Result returned by a PackageFetcher.
 */
export interface FetchResult {
  /** Canonical dependency key */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** Package name */
  name: string;
  /** Resolved version (for registry deps) */
  version?: string;
  /** Filesystem content root */
  contentRoot?: string;
  /** Repository root (for git sources) */
  repoRoot?: string;
  /** Source type */
  sourceType: 'registry' | 'path' | 'git';
  /** Full resolved source */
  source: ResolvedSource;
  /** Parsed package manifest */
  metadata?: PackageYml;
  /** Dependency declarations found in this package's manifest */
  childDependencies: DependencyDeclaration[];
  /** Whether this is a marketplace package */
  isMarketplace?: boolean;
  /** Pre-loaded package data (for path/git fetchers) */
  loaded?: LoadedPackageData;
}

/**
 * Options passed to individual fetchers.
 */
export interface FetcherOptions {
  /** Workspace root directory */
  workspaceRoot: string;
  /** How to resolve versions (local-only, remote-primary, default) */
  resolutionMode: InstallResolutionMode;
  /** Skip git cache */
  skipCache?: boolean;
  /** Authentication profile */
  profile?: string;
  /** API key for remote registry */
  apiKey?: string;
  /** Current depth in the dependency tree (for dev-dependency inclusion) */
  depth: number;
}

/**
 * Interface for source-type-specific package fetchers.
 */
export interface PackageFetcher {
  /** Fetch metadata and child dependencies for a single declaration. */
  fetch(
    declaration: DependencyDeclaration,
    declaredInDir: string,
    options: FetcherOptions
  ): Promise<FetchResult>;
}

/**
 * Top-level options for resolveWave().
 */
export interface WaveResolverOptions {
  /** Workspace root directory */
  workspaceRoot: string;
  /** Root manifest path. If not set, uses workspace .openpackage/openpackage.yml */
  rootManifestPath?: string;
  /** Include dev-dependencies at root level (default: true) */
  includeDev?: boolean;
  /** Include root manifest package itself as a node in the graph */
  includeRoot?: boolean;
  /** Force install even when conflicts exist */
  force?: boolean;
  /** Skip git cache (for --remote flag) */
  skipCache?: boolean;
  /** Version resolution mode */
  resolutionMode?: InstallResolutionMode;
  /** Safety valve: maximum number of resolved nodes (default: 10_000) */
  maxNodes?: number;
  /** Callback for interactive conflict resolution */
  onConflict?: (conflict: WaveVersionConflict, availableVersions: string[]) => Promise<string | null>;
  /** Authentication profile */
  profile?: string;
  /** API key for remote registry */
  apiKey?: string;
}
