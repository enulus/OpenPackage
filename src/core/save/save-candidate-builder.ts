import { join } from 'path';
import { exists, getStats, readTextFile, walkFiles } from '../../utils/fs.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { inferPlatformFromWorkspaceFile } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import { splitFrontmatter } from '../../utils/markdown-frontmatter.js';
import type { SaveCandidate, SaveCandidateSource } from './save-types.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';

/**
 * Core responsibility: Transform file system state into SaveCandidate objects
 * Input: File paths, registry mappings
 * Output: Categorized candidates (workspace vs local)
 */

export interface CandidateBuilderOptions {
  packageRoot: string;
  workspaceRoot: string;
  filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>;
}

export interface CandidateBuildResult {
  localCandidates: SaveCandidate[];
  workspaceCandidates: SaveCandidate[];
  errors: CandidateBuildError[];
}

export interface CandidateBuildError {
  path: string;
  registryPath: string;
  reason: string;
}

interface BuildCandidateOptions {
  packageRoot: string;
  workspaceRoot: string;
  inferPlatform?: boolean;
  parseMarkdown?: boolean;
}

/**
 * Build all candidates from index mapping
 * 
 * This function discovers all workspace and local (source) candidates
 * based on the workspace index mappings.
 */
export async function buildCandidates(
  options: CandidateBuilderOptions
): Promise<CandidateBuildResult> {
  const errors: CandidateBuildError[] = [];
  
  // Extract all registry paths from mappings
  const mappedRegistryPaths = Object.keys(options.filesMapping);
  
  // Build local candidates (from package source)
  const localCandidates = await buildLocalCandidates(
    options.packageRoot,
    mappedRegistryPaths
  );
  
  // Build workspace candidates (from workspace paths)
  const { candidates: workspaceCandidates, errors: workspaceErrors } = await buildWorkspaceCandidates(
    options.workspaceRoot,
    options.packageRoot,
    options.filesMapping
  );
  
  errors.push(...workspaceErrors);
  
  return {
    localCandidates,
    workspaceCandidates,
    errors
  };
}

/**
 * Build local (source) candidates for mapped registry paths only
 * 
 * Only loads files that exist in the index mapping - we don't want to
 * discover unmapped files in the source.
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
    }
  }
  
  return candidates;
}

/**
 * Build workspace candidates from mapped workspace paths
 * 
 * Discovers files in the workspace based on index mappings.
 * For directory mappings, recursively walks the directory tree.
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
        try {
          const files = await collectFilesUnderDirectory(absTargetPath);
          
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
            }
          }
        } catch (error) {
          errors.push({
            path: absTargetPath,
            registryPath: registryKey,
            reason: `Failed to enumerate directory: ${error}`
          });
        }
      } else {
        // File mapping: single file
        if (!(await exists(absTargetPath))) {
          // File doesn't exist in workspace - skip (not an error)
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
        }
      }
    }
  }
  
  return { candidates, errors };
}

/**
 * Build single candidate from file path
 * 
 * Reads file content, calculates hash, extracts metadata.
 * Returns null if file cannot be read.
 */
async function buildCandidate(
  source: SaveCandidateSource,
  absPath: string,
  registryPath: string,
  options: BuildCandidateOptions
): Promise<SaveCandidate | null> {
  try {
    const content = await readTextFile(absPath);
    const contentHash = await calculateFileHash(content);
    const stats = await getStats(absPath);
    
    // Calculate display path (relative to appropriate root)
    const displayPath = source === 'workspace'
      ? normalizePathForProcessing(absPath.slice(options.workspaceRoot.length + 1)) || registryPath
      : normalizePathForProcessing(absPath.slice(options.packageRoot.length + 1)) || registryPath;
    
    // Infer platform for workspace files
    const platform = options.inferPlatform && source === 'workspace'
      ? inferPlatformFromWorkspaceFile(absPath, deriveSourceDir(displayPath), registryPath, options.workspaceRoot)
      : undefined;
    
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
    logger.warn(`Failed to build candidate for ${absPath}: ${error}`);
    return null;
  }
}

/**
 * Collect all files under a directory recursively
 * 
 * Returns relative paths from the directory root.
 */
async function collectFilesUnderDirectory(absDir: string): Promise<string[]> {
  const collected: string[] = [];
  if (!(await exists(absDir))) return collected;
  
  for await (const absFile of walkFiles(absDir)) {
    const relPath = absFile.slice(absDir.length + 1).replace(/\\/g, '/');
    collected.push(relPath);
  }
  
  return collected;
}

/**
 * Derive source directory from relative path
 * 
 * Returns the first segment of the path (e.g., ".cursor" from ".cursor/commands/test.md")
 */
function deriveSourceDir(relPath: string | undefined): string {
  if (!relPath) return '';
  const first = relPath.split('/')[0] || '';
  return first;
}
