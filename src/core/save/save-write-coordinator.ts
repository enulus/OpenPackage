/**
 * Write Coordinator
 * 
 * This module coordinates file write operations for resolved save content.
 * It handles both universal content and platform-specific variants,
 * ensuring idempotent writes with optimization for unchanged files.
 * 
 * Key responsibilities:
 * - Build write operations from resolution results
 * - Execute writes to filesystem
 * - Handle directory creation
 * - Track success/failure for each write
 * - Optimize by skipping writes when content is identical
 * 
 * @module save-write-coordinator
 */

import { dirname, join } from 'path';
import { ensureDir, exists, readTextFile, writeTextFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { createPlatformSpecificRegistryPath } from '../../utils/platform-specific-paths.js';
import type { SaveCandidate, ResolutionResult, WriteOperation, WriteResult } from './save-types.js';

/**
 * Write resolution results to package source
 * 
 * This is the main entry point for file writes. It handles both:
 * - Universal content (if selected)
 * - Platform-specific content (for each platform candidate)
 * 
 * Each write is tracked individually with success/failure status.
 * Individual write failures don't halt the pipeline.
 * 
 * @param packageRoot - Absolute path to package source
 * @param registryPath - Registry path being written
 * @param resolution - Resolution result from conflict resolution
 * @param localCandidate - Optional local (source) candidate for comparison
 * @returns Array of write results (one per write operation)
 */
export async function writeResolution(
  packageRoot: string,
  registryPath: string,
  resolution: ResolutionResult,
  localCandidate?: SaveCandidate
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  
  // Write universal content (if selected)
  if (resolution.selection) {
    const universalResult = await writeUniversal(
      packageRoot,
      registryPath,
      resolution.selection,
      localCandidate
    );
    results.push(universalResult);
  } else {
    // No universal selected - log this (user chose only platform-specific)
    logger.debug(`No universal content selected for ${registryPath} - keeping original untouched`);
  }
  
  // Write platform-specific content
  for (const platformCandidate of resolution.platformSpecific) {
    const platformResult = await writePlatformSpecific(
      packageRoot,
      registryPath,
      platformCandidate
    );
    results.push(platformResult);
  }
  
  return results;
}

/**
 * Write universal content to package source
 * 
 * Writes the selected workspace candidate to the universal (non-platform-specific)
 * path in the package source. Optimizes by skipping write if content is identical
 * to existing source.
 * 
 * @param packageRoot - Package source absolute path
 * @param registryPath - Registry path to write
 * @param candidate - Selected universal candidate
 * @param localCandidate - Optional local candidate for comparison
 * @returns Write result with success/failure status
 */
async function writeUniversal(
  packageRoot: string,
  registryPath: string,
  candidate: SaveCandidate,
  localCandidate?: SaveCandidate
): Promise<WriteResult> {
  const targetPath = join(packageRoot, registryPath);
  
  // Determine if write is needed (optimization)
  const writeDecision = shouldWrite(candidate, localCandidate);
  
  const operation: WriteOperation = {
    registryPath,
    targetPath,
    content: candidate.content,
    operation: writeDecision.operation,
    isPlatformSpecific: false
  };
  
  // Skip if no write needed
  if (!writeDecision.needed) {
    logger.debug(`Skipping write for ${registryPath}: content identical to source`);
    return {
      operation,
      success: true
    };
  }
  
  // Perform write
  const writeResult = await safeWrite(targetPath, candidate.content);
  
  if (writeResult.success) {
    logger.debug(
      `${operation.operation === 'create' ? 'Created' : 'Updated'} ${registryPath}`
    );
  }
  
  return {
    operation,
    success: writeResult.success,
    error: writeResult.error
  };
}

/**
 * Write platform-specific content to package source
 * 
 * Writes a platform-specific variant to its platform-specific path
 * (e.g., tools/search.cursor.md, CLAUDE.md).
 * 
 * @param packageRoot - Package source absolute path
 * @param registryPath - Universal registry path
 * @param candidate - Platform-specific candidate
 * @returns Write result with success/failure status
 */
async function writePlatformSpecific(
  packageRoot: string,
  registryPath: string,
  candidate: SaveCandidate
): Promise<WriteResult> {
  const platform = candidate.platform;
  
  // Validate platform
  if (!platform || platform === 'ai') {
    return {
      operation: {
        registryPath,
        targetPath: '',
        content: '',
        operation: 'skip',
        isPlatformSpecific: true
      },
      success: false,
      error: new Error('Candidate has no platform association')
    };
  }
  
  // Build platform-specific registry path
  const platformRegistryPath = createPlatformSpecificRegistryPath(registryPath, platform);
  if (!platformRegistryPath) {
    return {
      operation: {
        registryPath,
        targetPath: '',
        content: '',
        operation: 'skip',
        isPlatformSpecific: true,
        platform
      },
      success: false,
      error: new Error(`Could not create platform-specific path for ${platform}`)
    };
  }
  
  const targetPath = join(packageRoot, platformRegistryPath);
  
  // Determine operation type
  const fileExists = await exists(targetPath);
  const operationType: 'create' | 'update' = fileExists ? 'update' : 'create';
  
  const operation: WriteOperation = {
    registryPath: platformRegistryPath,
    targetPath,
    content: candidate.content,
    operation: operationType,
    isPlatformSpecific: true,
    platform
  };
  
  // Check if content matches existing (optimization)
  if (fileExists) {
    try {
      const existingContent = await readTextFile(targetPath);
      if (existingContent === candidate.content) {
        logger.debug(`Skipping write for ${platformRegistryPath}: content identical`);
        operation.operation = 'skip';
        return {
          operation,
          success: true
        };
      }
    } catch (error) {
      // Ignore read errors - will attempt write anyway
      logger.debug(`Could not read existing file ${platformRegistryPath}: ${error}`);
    }
  }
  
  // Perform write
  const writeResult = await safeWrite(targetPath, candidate.content);
  
  if (writeResult.success) {
    logger.debug(
      `${operationType === 'create' ? 'Created' : 'Updated'} platform-specific file: ${platformRegistryPath}`
    );
  }
  
  return {
    operation,
    success: writeResult.success,
    error: writeResult.error
  };
}

/**
 * Determine if write is needed (optimization)
 * 
 * Compares candidate content with local (source) content via hash.
 * Returns whether write is needed and what operation type.
 * 
 * @param candidate - Workspace candidate to write
 * @param localCandidate - Optional local (source) candidate
 * @returns Write decision with needed flag and operation type
 */
function shouldWrite(
  candidate: SaveCandidate,
  localCandidate?: SaveCandidate
): { needed: boolean; operation: 'create' | 'update' | 'skip' } {
  // No local candidate means file doesn't exist - create
  if (!localCandidate) {
    return { needed: true, operation: 'create' };
  }
  
  // Compare content hashes
  if (candidate.contentHash === localCandidate.contentHash) {
    // Content identical - skip write
    return { needed: false, operation: 'skip' };
  }
  
  // Content differs - update
  return { needed: true, operation: 'update' };
}

/**
 * Safely write file with error handling
 * 
 * Ensures parent directory exists before writing.
 * Returns success/error result without throwing.
 * 
 * @param targetPath - Absolute filesystem path to write
 * @param content - Content to write
 * @returns Result with success flag and optional error
 */
async function safeWrite(
  targetPath: string,
  content: string
): Promise<{ success: boolean; error?: Error }> {
  try {
    // Ensure parent directory exists
    await ensureDir(dirname(targetPath));
    
    // Write file
    await writeTextFile(targetPath, content);
    
    return { success: true };
  } catch (error) {
    logger.error(`Failed to write file ${targetPath}: ${error}`);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
