import { join } from 'path';
import { exists } from '../../utils/fs.js';
import { createPlatformSpecificRegistryPath } from '../../utils/platform-specific-paths.js';
import { logger } from '../../utils/logger.js';
import type { SaveCandidate, SaveCandidateGroup } from './save-types.js';

/**
 * Platform-specific candidate management
 * 
 * This module handles the lifecycle of platform-specific candidates in the save pipeline.
 * Primary responsibility: prune workspace candidates that would conflict with existing
 * platform-specific files in the package source.
 * 
 * @module save-platform-handler
 */

/**
 * Prune workspace candidates that have existing platform files in source
 * 
 * This function removes workspace candidates from groups when a platform-specific
 * file already exists in the source. This prevents prompting the user to save
 * content that would overwrite an existing platform file.
 * 
 * **Rationale**: If a platform-specific file like `.cursor/tools/search.md` exists
 * in the source, and the workspace has `.cursor/tools/search.md` with different
 * content, we should not prompt to save it. The existing platform file takes precedence.
 * 
 * **Example**:
 * ```
 * Before pruning:
 *   Group { registryPath: "tools/calc.md",
 *     local: { hash: "aaa" },
 *     workspace: [
 *       { platform: "cursor", hash: "bbb" },
 *       { platform: "claude", hash: "ccc" }
 *     ]
 *   }
 * 
 * Source structure:
 *   tools/calc.md (universal)
 *   .cursor/tools/calc.md (exists!)
 * 
 * After pruning:
 *   Group { registryPath: "tools/calc.md",
 *     workspace: [
 *       { platform: "claude", hash: "ccc" }  // cursor pruned
 *     ]
 *   }
 * ```
 * 
 * @param packageRoot - Absolute path to the package source directory
 * @param groups - Array of candidate groups (mutated in-place)
 * 
 * @mutates groups - Modifies workspace array in each group
 */
export async function pruneExistingPlatformCandidates(
  packageRoot: string,
  groups: SaveCandidateGroup[]
): Promise<void> {
  for (const group of groups) {
    // No local file means no platform files could exist yet
    // Skip pruning for new files
    if (!group.local && !group.localRef) {
      continue;
    }
    
    const filtered: SaveCandidate[] = [];
    
    for (const candidate of group.workspace) {
      const platform = candidate.platform;
      
      // Keep non-platform candidates (universal files)
      // 'ai' is treated as universal, not platform-specific
      if (!platform || platform === 'ai') {
        filtered.push(candidate);
        continue;
      }
      
      // Construct platform-specific registry path
      // e.g., "tools/search.md" + "cursor" -> ".cursor/tools/search.cursor.md"
      const platformPath = createPlatformSpecificRegistryPath(
        group.registryPath, 
        platform
      );
      
      // If platform doesn't support this file type, keep candidate
      if (!platformPath) {
        filtered.push(candidate);
        continue;
      }
      
      // Check if platform-specific file exists in source
      const platformFullPath = join(packageRoot, platformPath);
      const hasPlatformFile = await exists(platformFullPath);
      
      if (hasPlatformFile) {
        // Platform file exists - prune this candidate
        logger.debug(
          `Pruning workspace candidate ${candidate.displayPath} for ${group.registryPath} ` +
          `(platform file ${platformPath} exists in source)`
        );
        continue; // Don't add to filtered array
      }
      
      // No existing platform file - keep candidate for potential save
      filtered.push(candidate);
    }
    
    // Replace workspace array with filtered candidates
    group.workspace = filtered;
  }
}
