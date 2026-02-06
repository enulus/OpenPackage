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

import { join } from 'path';
import { exists, getStats, readTextFile, walkFiles } from '../../utils/fs.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { inferPlatformFromWorkspaceFile } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import { splitFrontmatter } from '../../utils/markdown-frontmatter.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import type { SaveCandidate, SaveCandidateSource, CandidateBuildError } from './save-types.js';
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
  /** Candidates from package source */
  localCandidates: SaveCandidate[];
  
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
  
  // Extract all registry paths from mappings
  const mappedRegistryPaths = Object.keys(options.filesMapping);
  
  // Build local candidates (from package source)
  logger.debug(`Building local candidates from package source`);
  const localCandidates = await buildLocalCandidates(
    options.packageRoot,
    mappedRegistryPaths
  );
  
  // Build workspace candidates (from workspace paths)
  logger.debug(`Building workspace candidates from workspace paths`);
  const { candidates: workspaceCandidates, errors: workspaceErrors } = await buildWorkspaceCandidates(
    options.workspaceRoot,
    options.packageRoot,
    options.filesMapping
  );
  
  errors.push(...workspaceErrors);
  
  logger.debug(
    `Built ${localCandidates.length} local candidates, ${workspaceCandidates.length} workspace candidates`
  );
  
  return {
    localCandidates,
    workspaceCandidates,
    errors
  };
}

/**
 * Build local (source) candidates for mapped registry paths only
 * 
 * Only loads files that exist in the index mapping - we don't discover
 * unmapped files in the source.
 * 
 * @param packageRoot - Absolute path to package root
 * @param mappedRegistryPaths - Registry paths from workspace index
 * @returns Array of local candidates
 */
async function buildLocalCandidates(
  packageRoot: string,
  mappedRegistryPaths: string[]
): Promise<SaveCandidate[]> {
  const candidates: SaveCandidate[] = [];
  
  for (const rawKey of mappedRegistryPaths) {
    const normalizedKey = normalizePathForProcessing(rawKey);
    if (!normalizedKey) continue;
    
    // Skip directory keys - we'll enumerate their contents separately
    if (normalizedKey.endsWith('/')) continue;
    
    const absLocal = join(packageRoot, normalizedKey);
    if (!(await exists(absLocal))) {
      // File doesn't exist in source yet - this is fine (will be created)
      logger.debug(`Local file not found (will be created): ${normalizedKey}`);
      continue;
    }
    
    const candidate = await buildCandidate('local', absLocal, normalizedKey, {
      packageRoot,
      workspaceRoot: packageRoot, // Not used for local candidates
      inferPlatform: false, // Local candidates don't have platform inference
      parseMarkdown: true
    });
    
    if (candidate) {
      candidates.push(candidate);
      logger.debug(`Built local candidate: ${normalizedKey}`);
    }
  }
  
  return candidates;
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
              parseMarkdown: true
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
          parseMarkdown: true
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
      isMarkdown
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
