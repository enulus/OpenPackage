/**
 * Save Candidate Builder Module
 * 
 * Core responsibility: Transform filesystem files into SaveCandidate objects with metadata
 * 
 * This module handles the discovery and transformation of files from both:
 * - Package source (local candidates)
 * - Workspace paths (workspace candidates)
 * 
 * For each file, it:
 * - Reads content and calculates hash
 * - Extracts metadata (mtime, display path)
 * - Infers platform for workspace files
 * - Parses markdown frontmatter when applicable
 */

import { join, relative } from 'path';
import { exists, getStats, readTextFile, walkFiles } from '../../utils/fs.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { inferPlatformFromWorkspaceFile } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import { splitFrontmatter } from '../../utils/markdown-frontmatter.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import type { SaveCandidate, SaveCandidateSource, CandidateBuildError, LocalSourceRef } from './save-types.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';

/**
 * Options for building candidates
 */
export interface CandidateBuilderOptions {
  /** Absolute path to package source root */
  packageRoot: string;
  
  /** Absolute path to workspace root */
  workspaceRoot: string;
  
  /** File mappings from workspace index */
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>;
}

/**
 * Result of candidate building process
 */
export interface CandidateBuildResult {
  /** Candidates from package source (empty when using lazy path via localSourceRefs) */
  localCandidates: SaveCandidate[];
  
  /** Lightweight refs for local source files (used for lazy materialization) */
  localSourceRefs: LocalSourceRef[];
  
  /** Candidates from workspace */
  workspaceCandidates: SaveCandidate[];
  
  /** Non-fatal errors encountered during building */
  errors: CandidateBuildError[];
}

/**
 * Internal options for buildCandidate function
 */
interface BuildCandidateOptions {
  packageRoot: string;
  workspaceRoot: string;
  inferPlatform?: boolean;
  parseMarkdown?: boolean;
  mergeStrategy?: 'deep' | 'shallow' | 'replace' | 'composite';
  mergeKeys?: string[];
}

/**
 * Build all candidates from index mapping
 * 
 * Main entry point that orchestrates candidate discovery from both
 * package source and workspace paths.
 * 
 * @param options - Builder options with roots and mappings
 * @returns Result with local/workspace candidates and any errors
 */
export async function buildCandidates(
  options: CandidateBuilderOptions
): Promise<CandidateBuildResult> {
  const errors: CandidateBuildError[] = [];
  
  // Build workspace candidates (from workspace paths)
  logger.debug(`Building workspace candidates from workspace paths`);
  const { candidates: workspaceCandidates, errors: workspaceErrors } = await buildWorkspaceCandidates(
    options.workspaceRoot,
    options.packageRoot,
    options.filesMapping
  );
  
  errors.push(...workspaceErrors);
  
  // Build lightweight local source refs (no file reads)
  logger.debug(`Building local source refs from package source (lazy mode)`);
  const localSourceRefs = await buildLocalSourceRefs(
    options.packageRoot
  );
  
  logger.debug(
    `Built ${localSourceRefs.length} local source refs, ${workspaceCandidates.length} workspace candidates`
  );
  
  return {
    localCandidates: [],
    localSourceRefs,
    workspaceCandidates,
    errors
  };
}

/**
 * Build lightweight local source refs by discovering all files in source directory.
 * Only captures path metadata (registryPath, fullPath) without reading content.
 */
async function buildLocalSourceRefs(
  packageRoot: string
): Promise<LocalSourceRef[]> {
  const refs: LocalSourceRef[] = [];
  
  for await (const absPath of walkFiles(packageRoot)) {
    const relPath = relative(packageRoot, absPath);
    const normalizedPath = normalizePathForProcessing(relPath);
    
    if (!normalizedPath) continue;
    
    if (normalizedPath.startsWith('.openpackage/') || normalizedPath === 'openpackage.yml') {
      continue;
    }
    
    if (normalizedPath.startsWith('.') && !normalizedPath.match(/^\.(cursor|claude|opencode|windsurf|roo|factory|kilo|qwen|warp|codex|pi|kilocode|agent|augment)/)) {
      continue;
    }
    
    refs.push({ registryPath: normalizedPath, fullPath: absPath });
    logger.debug(`Built local source ref: ${normalizedPath}`);
  }
  
  return refs;
}

/**
 * Materialize a full SaveCandidate from a lightweight LocalSourceRef.
 * Reads file content, hash, stats, and frontmatter on demand.
 */
export async function materializeLocalCandidate(
  ref: LocalSourceRef,
  packageRoot: string
): Promise<SaveCandidate | null> {
  return buildCandidate('local', ref.fullPath, ref.registryPath, {
    packageRoot,
    workspaceRoot: packageRoot,
    inferPlatform: false,
    parseMarkdown: true
  });
}

/**
 * Build workspace candidates from mapped workspace paths
 * 
 * Discovers files in the workspace based on index mappings.
 * Handles both file mappings and directory mappings (recursive walk).
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param packageRoot - Absolute path to package root
 * @param filesMapping - File mappings from workspace index
 * @returns Object with candidates array and errors array
 */
async function buildWorkspaceCandidates(
  workspaceRoot: string,
  packageRoot: string,
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>
): Promise<{ candidates: SaveCandidate[]; errors: CandidateBuildError[] }> {
  const candidates: SaveCandidate[] = [];
  const errors: CandidateBuildError[] = [];
  
  for (const [rawKey, targets] of Object.entries(filesMapping)) {
    const registryKey = normalizePathForProcessing(rawKey);
    if (!registryKey || !Array.isArray(targets)) continue;
    
    const isDirectoryMapping = registryKey.endsWith('/');
    
    for (const mapping of targets) {
      const workspaceRel = getTargetPath(mapping);
      const normalizedTargetPath = normalizePathForProcessing(workspaceRel);
      if (!normalizedTargetPath) continue;
      
      const absTargetPath = join(workspaceRoot, normalizedTargetPath);
      
      // Extract merge metadata if present
      const mergeMetadata = typeof mapping === 'object' && mapping !== null
        ? { merge: mapping.merge, keys: mapping.keys }
        : undefined;
      
      if (isDirectoryMapping) {
        // Directory mapping: enumerate all files under the directory
        logger.debug(`Enumerating directory mapping: ${registryKey} -> ${normalizedTargetPath}`);
        try {
          const files = await collectFilesUnderDirectory(absTargetPath);
          logger.debug(`Found ${files.length} files under directory ${normalizedTargetPath}`);
          
          for (const relFile of files) {
            const registryPath = normalizePathForProcessing(join(registryKey, relFile));
            if (!registryPath) continue;
            
            const absWorkspaceFile = join(absTargetPath, relFile);
            const candidate = await buildCandidate('workspace', absWorkspaceFile, registryPath, {
              packageRoot,
              workspaceRoot,
              inferPlatform: true,
              parseMarkdown: true,
              mergeStrategy: mergeMetadata?.merge,
              mergeKeys: mergeMetadata?.keys
            });
            
            if (candidate) {
              candidates.push(candidate);
              logger.debug(`Built workspace candidate: ${registryPath} (from directory)`);
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push({
            path: absTargetPath,
            registryPath: registryKey,
            reason: `Failed to enumerate directory: ${errorMsg}`
          });
          logger.warn(`Failed to enumerate directory ${absTargetPath}: ${errorMsg}`);
        }
      } else {
        // File mapping: single file
        if (!(await exists(absTargetPath))) {
          // File doesn't exist in workspace - skip (not an error)
          logger.debug(`Workspace file not found (skipping): ${normalizedTargetPath}`);
          continue;
        }
        
        const candidate = await buildCandidate('workspace', absTargetPath, registryKey, {
          packageRoot,
          workspaceRoot,
          inferPlatform: true,
          parseMarkdown: true,
          mergeStrategy: mergeMetadata?.merge,
          mergeKeys: mergeMetadata?.keys
        });
        
        if (candidate) {
          candidates.push(candidate);
          logger.debug(`Built workspace candidate: ${registryKey}`);
        }
      }
    }
  }
  
  return { candidates, errors };
}

/**
 * Build single candidate from file path
 * 
 * Core transformation: file → candidate
 * 
 * Steps:
 * 1. Read file content
 * 2. Calculate hash
 * 3. Get file stats (mtime)
 * 4. Calculate display path
 * 5. Infer platform (workspace only)
 * 6. Parse markdown frontmatter (if applicable)
 * 7. Construct SaveCandidate object
 * 
 * @param source - 'local' or 'workspace'
 * @param absPath - Absolute path to file
 * @param registryPath - Registry path for this file
 * @param options - Build options
 * @returns SaveCandidate or null if failed
 */
async function buildCandidate(
  source: SaveCandidateSource,
  absPath: string,
  registryPath: string,
  options: BuildCandidateOptions
): Promise<SaveCandidate | null> {
  try {
    // Read file content
    const content = await readTextFile(absPath);
    
    // Calculate content hash
    const contentHash = await calculateFileHash(content);
    
    // Get file stats
    const stats = await getStats(absPath);
    
    // Calculate display path (relative to appropriate root)
    const rootPath = source === 'workspace' ? options.workspaceRoot : options.packageRoot;
    const relPath = absPath.slice(rootPath.length + 1);
    const displayPath = normalizePathForProcessing(relPath) || registryPath;
    
    // Infer platform for workspace files
    let platform: string | undefined;
    if (options.inferPlatform && source === 'workspace') {
      const sourceDir = deriveSourceDir(displayPath);
      platform = inferPlatformFromWorkspaceFile(
        absPath,
        sourceDir,
        registryPath,
        options.workspaceRoot
      );
    }
    
    // Parse markdown frontmatter if enabled
    let frontmatter: any = undefined;
    let rawFrontmatter: string | undefined;
    let markdownBody: string | undefined;
    let isMarkdown = false;
    
    if (options.parseMarkdown && (absPath.endsWith('.md') || absPath.endsWith('.markdown'))) {
      isMarkdown = true;
      try {
        const parsed = splitFrontmatter(content);
        if (parsed.frontmatter && Object.keys(parsed.frontmatter).length > 0) {
          frontmatter = parsed.frontmatter;
          rawFrontmatter = parsed.rawFrontmatter;
          markdownBody = parsed.body;
        }
      } catch (error) {
        logger.debug(`Failed to parse frontmatter for ${absPath}: ${error}`);
      }
    }
    
    // Construct candidate
    const candidate: SaveCandidate = {
      source,
      registryPath,
      fullPath: absPath,
      content,
      contentHash,
      mtime: stats.mtime.getTime(),
      displayPath,
      platform,
      frontmatter,
      rawFrontmatter,
      markdownBody,
      isMarkdown,
      mergeStrategy: options.mergeStrategy,
      mergeKeys: options.mergeKeys
    };
    
    return candidate;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to build candidate for ${absPath}: ${errorMsg}`);
    return null;
  }
}

/**
 * Collect all files under a directory recursively
 * 
 * Uses walkFiles utility for recursive traversal.
 * Returns relative paths from the directory root.
 * 
 * @param absDir - Absolute directory path
 * @returns Array of relative file paths
 */
async function collectFilesUnderDirectory(absDir: string): Promise<string[]> {
  const collected: string[] = [];
  
  // Check if directory exists
  if (!(await exists(absDir))) {
    return collected;
  }
  
  // Walk files recursively
  for await (const absFile of walkFiles(absDir)) {
    // Calculate relative path from directory root
    const relPath = absFile.slice(absDir.length + 1).replace(/\\/g, '/');
    collected.push(relPath);
  }
  
  return collected;
}

/**
 * Derive source directory from relative path
 * 
 * Extracts the first path segment for platform inference.
 * 
 * Example: ".cursor/commands/test.md" → ".cursor"
 * 
 * @param relPath - Relative path
 * @returns First path segment
 */
function deriveSourceDir(relPath: string | undefined): string {
  if (!relPath) return '';
  const first = relPath.split('/')[0] || '';
  return first;
}
