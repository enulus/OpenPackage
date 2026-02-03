/**
 * Recursive dependency resolution system.
 * Public exports for graph building, loading, planning, and execution.
 */

export { DependencyGraphBuilder } from './graph-builder.js';
export { PackageLoader, clearLoadCache } from './package-loader.js';
export { InstallationPlanner } from './installation-planner.js';
export { DependencyResolutionExecutor } from './executor.js';
export { computeDependencyId, normalizeGitUrl } from './id-generator.js';
export {
  readManifestAtPath,
  readManifestFromSource,
  extractDependencies,
  getDeclaredInDir,
  getManifestPathAtContentRoot
} from './manifest-reader.js';

export type {
  DependencyId,
  DependencyDeclaration,
  ResolvedSource,
  LoadedPackageData,
  NodeState,
  ResolutionDependencyNode,
  DependencyCycle,
  GraphMetadata,
  DependencyGraph,
  SkippedPackage,
  InstallationPlan,
  GraphBuilderOptions,
  PackageLoaderOptions,
  InstallationPlannerOptions,
  ExecutorOptions,
  PackageResult,
  ExecutionSummary,
  ExecutionResult,
  ParsedManifest,
  BaseDetectionResult
} from './types.js';
