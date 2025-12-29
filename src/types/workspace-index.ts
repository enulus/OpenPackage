/**
 * Unified workspace index types.
 * Represents installed packages and their workspace file mappings.
 */
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
   */
  files: Record<string, string[]>;
}

export interface WorkspaceIndex {
  packages: Record<string, WorkspaceIndexPackage>;
}
