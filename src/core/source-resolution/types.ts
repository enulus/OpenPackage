import type { SourceType, Mutability, ResolutionSource } from '../../constants/index.js';

export type { SourceType, Mutability, ResolutionSource };

export interface ResolvedPackageSource {
  /**
   * Normalized package name (lowercased).
   */
  packageName: string;
  /**
   * Absolute, fully resolved filesystem path to the source of truth.
   */
  absolutePath: string;
  /**
   * Declared path as it should appear in YAML (tilde/relative preserved).
   */
  declaredPath: string;
  /**
   * Whether callers are allowed to write to this source.
   */
  mutability: Mutability;
  /**
   * Resolved version, if known (registry-based or provided by dependency spec).
   */
  version?: string;
  /**
   * Origin classification.
   */
  sourceType: SourceType;
  /**
   * Where the version was resolved from when using registry semantics.
   */
  resolutionSource?: ResolutionSource;
}

export interface DependencyGraphNode {
  name: string;
  version?: string;
  source: ResolvedPackageSource;
  dependencies: string[];
}
