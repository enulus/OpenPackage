/**
 * Lockfile types for portable dependency resolution.
 *
 * The lockfile captures resolution decisions (version, dependency graph)
 * that are portable across environments. Separate from the workspace index
 * which tracks installation state (file mappings, hashes, namespace).
 */

import type { MarketplaceMetadata } from './workspace-index.js';

export interface LockfilePackage {
  version?: string;
  dependencies?: string[];
  marketplace?: MarketplaceMetadata;
  /** Resolved path from source root to package root. For path sources: filesystem path. For git sources: subdirectory within repo. */
  base?: string;
  /** Resource selection path within the package (partial installs). */
  path?: string;
  /** For git sources: repository URL (no embedded #ref). */
  url?: string;
  /** For git sources: resolved commit SHA. */
  ref?: string;
}

export interface Lockfile {
  lockfileVersion: 1;
  packages: Record<string, LockfilePackage>;
}
