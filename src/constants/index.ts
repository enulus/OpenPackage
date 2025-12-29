/**
 * Shared constants for the OpenPackage CLI application
 * This file provides a single source of truth for all directory names,
 * file patterns, and other constants used throughout the application.
 */

export const DIR_PATTERNS = {
  OPENPACKAGE: '.openpackage'
} as const;

export const FILE_PATTERNS = {
  MD_FILES: '.md',
  MDC_FILES: '.mdc',
  TOML_FILES: '.toml',
  OPENPACKAGE_YML: 'openpackage.yml',
  OPENPACKAGE_INDEX_YML: 'openpackage.index.yml',
  README_MD: 'README.md',
  // Platform-specific root files
  AGENTS_MD: 'AGENTS.md',
  CLAUDE_MD: 'CLAUDE.md',
  GEMINI_MD: 'GEMINI.md',
  QWEN_MD: 'QWEN.md',
  WARP_MD: 'WARP.md',
  // File patterns arrays
  MARKDOWN_FILES: ['.md', '.mdc'],
  YML_FILE: '.yml',
} as const;

// Universal subdirectory names are now dynamically discovered from platform configs
// No hardcoded subdirs - platforms define their own universal directories

export const OPENPACKAGE_DIRS = {
  REGISTRY: 'registry',
  PACKAGES: 'packages',
  CACHE: 'cache',
  RUNTIME: 'runtime'
} as const;

/**
 * Package root directory names (relative to package root).
 */
export const PACKAGE_ROOT_DIRS = {
  /**
   * Direct copy directory: files under `root/**` are copied 1:1 to workspace root
   * with the `root/` prefix stripped during install.
   */
  ROOT_COPY: 'root'
} as const;

/**
 * Canonical paths within a package or cached copy (relative to the package root).
 */
export const PACKAGE_PATHS = {
  /**
   * The canonical location of the package manifest within a package:
   * <package-root>/openpackage.yml
   */
  MANIFEST_RELATIVE: `${FILE_PATTERNS.OPENPACKAGE_YML}`,
  /**
   * The canonical location of the package index file within a cached package copy:
   * <cached-package-root>/openpackage.index.yml
   */
  INDEX_RELATIVE: `${FILE_PATTERNS.OPENPACKAGE_INDEX_YML}`,
} as const;

export const DEPENDENCY_ARRAYS = {
  PACKAGES: 'packages',
  DEV_PACKAGES: 'dev-packages'
} as const;

export const CONFLICT_RESOLUTION = {
  SKIPPED: 'skipped',
  KEPT: 'kept',
  OVERWRITTEN: 'overwritten'
} as const;

export const UNVERSIONED = '0.0.0' as const;

export type FilePattern = typeof FILE_PATTERNS[keyof typeof FILE_PATTERNS];
export type UniversalSubdir = string;
export type OpenPackageDir = typeof OPENPACKAGE_DIRS[keyof typeof OPENPACKAGE_DIRS];
export type DependencyArray = typeof DEPENDENCY_ARRAYS[keyof typeof DEPENDENCY_ARRAYS];
export type ConflictResolution = typeof CONFLICT_RESOLUTION[keyof typeof CONFLICT_RESOLUTION];
