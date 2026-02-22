import type { Package } from '../../types/index.js';

/**
 * Resolved package interface for dependency resolution
 */
export interface ResolvedPackage {
  name: string;
  version: string;
  pkg: Package;
  isRoot: boolean;
  /**
   * Where the selected version came from during resolution.
   * - 'local'  => resolved purely from local registry data
   * - 'remote' => required remote metadata/versions to satisfy constraints
   * - 'path'   => loaded directly from a local directory or tarball path
   * - 'git'    => loaded from a git repository
   *
   * This is used for UX-only surfaces (e.g. install summaries) and does not
   * affect any resolution logic.
   */
  source?: 'local' | 'remote' | 'path' | 'git';
  /**
   * For path-based and git-based sources, stores the absolute path to the package content root.
   * This allows the installation phase to load files from the correct location.
   */
  contentRoot?: string;
  conflictResolution?: 'kept' | 'overwritten' | 'skipped';
  requiredVersion?: string; // The version required by the parent package
  requiredRange?: string; // The version range required by the parent package
  /**
   * Marketplace source metadata for plugins defined in marketplace.json
   */
  marketplaceMetadata?: {
    url: string;
    commitSha: string;
    pluginName: string;
  };
  /**
   * Resource-specific version (for agent/skill installations with individual versions)
   */
  resourceVersion?: string;
}

/**
 * Dependency node interface for dependency tree operations
 */
export interface DependencyNode {
  name: string;
  version: string;
  dependencies: Set<string>;
  dependents: Set<string>;
  isProtected: boolean; // Listed in cwd openpackage.yml
}
