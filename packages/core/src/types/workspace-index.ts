/**
 * Unified workspace index types.
 * Represents installed packages and their workspace file mappings.
 */

/**
 * Represents a file mapping with optional key-level tracking for merged files
 */
export interface WorkspaceIndexFileMapping {
  /**
   * Target workspace path
   */
  target: string;
  
  /**
   * Merge strategy used (if applicable)
   */
  merge?: 'deep' | 'shallow' | 'replace' | 'composite';
  
  /**
   * Specific keys contributed by this package (after transformations)
   * Used for precise removal during uninstall of merged files
   * Example: ["mcp.server1", "mcp.server2"]
   */
  keys?: string[];
}

export interface WorkspaceIndexPackage {
  /**
   * Declared path (tilde/relative preserved) or absolute path if inferred.
   */
  path: string;
  /**
   * Resolved registry version (if installed from registry).
   */
  version?: string;
  /**
   * Optional cached dependency names.
   * Commands must remain correct even if this is absent.
   */
  dependencies?: string[];
  /**
   * Mapping of package-relative paths to one or more workspace target paths.
   * Each entry can be a simple string (for non-merged files) or an object with key tracking (for merged files).
   */
  files: Record<string, (string | WorkspaceIndexFileMapping)[]>;
  /**
   * Marketplace source metadata for plugins defined in marketplace.json
   * When present, indicates this plugin came from a marketplace and may need
   * marketplace metadata for apply operations.
   */
  marketplace?: {
    /** Git URL of the marketplace repository */
    url: string;
    /** Commit SHA of the cached marketplace */
    commitSha: string;
    /** Plugin name within the marketplace (before scoping) */
    pluginName: string;
  };
}

export interface WorkspaceIndex {
  packages: Record<string, WorkspaceIndexPackage>;
}
