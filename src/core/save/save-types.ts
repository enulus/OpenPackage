/**
 * Type definitions for the enhanced save subsystem
 * 
 * This module defines the core data structures used across all phases of the
 * save pipeline, including candidates, groups, resolution strategies, and write operations.
 */

import type { Platform } from '../platforms.js';

/**
 * Lightweight reference to a local source file (path metadata only, no content).
 * Used during the grouping phase to avoid reading file content eagerly.
 */
export interface LocalSourceRef {
  registryPath: string;
  fullPath: string;
}

/**
 * Source type for a save candidate
 * - 'local': File exists in package source
 * - 'workspace': File exists in workspace
 */
export type SaveCandidateSource = 'local' | 'workspace';

/**
 * SaveCandidate represents a single file version with rich metadata
 * 
 * A candidate can come from either the package source (local) or the workspace.
 * Each candidate contains content, hash, timestamps, and optional platform/frontmatter data.
 */
export interface SaveCandidate {
  /** Source location: 'local' (package) or 'workspace' */
  source: SaveCandidateSource;
  
  /** Normalized registry path (e.g., "tools/search.md") */
  registryPath: string;
  
  /** Absolute filesystem path */
  fullPath: string;
  
  /** File content as string */
  content: string;
  
  /** Content hash for comparison (xxhash3) */
  contentHash: string;
  
  /** Modification timestamp in milliseconds */
  mtime: number;
  
  /** User-friendly relative display path */
  displayPath: string;
  
  /** Inferred platform for workspace files ('cursor', 'claude', 'windsurf', etc.) */
  platform?: Platform | 'ai';
  
  /** Whether this is a root package file (AGENTS.md, etc.) */
  isRootFile?: boolean;
  
  /** Parsed YAML frontmatter (for markdown files) */
  frontmatter?: any;
  
  /** Raw frontmatter text (without delimiters) */
  rawFrontmatter?: string;
  
  /** Markdown body without frontmatter */
  markdownBody?: string;
  
  /** Whether the file is markdown */
  isMarkdown?: boolean;
  
  /** Merge strategy used during installation (for workspace files) */
  mergeStrategy?: 'deep' | 'shallow' | 'replace' | 'composite';
  
  /** Keys contributed by this package (for merged files) */
  mergeKeys?: string[];
  
  /** Cached comparable hash (after conversion/extraction), computed once */
  comparableHash?: string;

  /** Cached extracted content (for merged files), computed once */
  extractedContent?: string;
}

/**
 * SaveCandidateGroup organizes all versions of a single file by registry path
 * 
 * A group contains:
 * - One optional local (source) candidate
 * - Zero or more workspace candidates (may have platform variants)
 */
export interface SaveCandidateGroup {
  /** The canonical registry path for this group */
  registryPath: string;
  
  /** Optional local (source) candidate (materialized on demand) */
  local?: SaveCandidate;
  
  /** Lightweight local source reference (set during grouping, before materialization) */
  localRef?: LocalSourceRef;
  
  /** Array of workspace candidates (may be empty, single, or multiple) */
  workspace: SaveCandidate[];
}

/**
 * ResolutionStrategy defines the approach to resolve a candidate group
 * 
 * Strategies progress from automatic to interactive based on conflict complexity:
 * - 'skip': No workspace candidates (no action needed)
 * - 'write-single': Single workspace candidate (auto-write)
 * - 'write-newest': Multiple identical candidates (auto-write newest)
 * - 'force-newest': Multiple differing candidates, force mode enabled (auto-select newest)
 * - 'interactive': Multiple differing candidates, user prompt required
 */
export type ResolutionStrategy =
  | 'skip'
  | 'write-single'
  | 'write-newest'
  | 'force-newest'
  | 'interactive';

/**
 * ResolutionResult captures the outcome of resolving a candidate group
 * 
 * Contains:
 * - The selected universal candidate (or null if only platform-specific)
 * - Any platform-specific candidates to preserve separately
 * - The strategy used
 * - Whether user interaction occurred
 */
export interface ResolutionResult {
  /** Chosen universal candidate (null if only platform-specific variants) */
  selection: SaveCandidate | null;
  
  /** Array of candidates marked as platform-specific */
  platformSpecific: SaveCandidate[];
  
  /** Which resolution strategy was used */
  strategy: ResolutionStrategy;
  
  /** Whether user was prompted */
  wasInteractive: boolean;
}

/**
 * WriteOperation describes a pending file write
 * 
 * Represents an operation to be executed against the filesystem,
 * including target path, content, and operation type.
 */
export interface WriteOperation {
  /** Target registry path */
  registryPath: string;
  
  /** Absolute filesystem target path */
  targetPath: string;
  
  /** Content to write */
  content: string;
  
  /** Operation type */
  operation: 'create' | 'update' | 'skip';
  
  /** Whether this is a platform-specific file */
  isPlatformSpecific: boolean;
  
  /** Platform name if applicable */
  platform?: string;
}

/**
 * WriteResult captures the outcome of a write operation
 * 
 * Tracks success/failure for each write with optional error details.
 */
export interface WriteResult {
  /** The write operation that was executed */
  operation: WriteOperation;
  
  /** Whether the write succeeded */
  success: boolean;
  
  /** Optional error object if write failed */
  error?: Error;
}

/**
 * CandidateBuildError represents a non-fatal error during candidate building
 * 
 * These errors are collected and reported but don't halt the pipeline.
 */
export interface CandidateBuildError {
  /** Filesystem path that failed */
  path: string;
  
  /** Intended registry path */
  registryPath: string;
  
  /** Human-readable error message */
  reason: string;
}
