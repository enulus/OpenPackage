/**
 * Save Merge Extractor Module
 * 
 * Provides utilities to extract package-specific contributions from merged files.
 * This enables proper parity checking for files that were merged during installation.
 * 
 * Key responsibilities:
 * - Extract only the keys contributed by the package from merged JSON/YAML files
 * - Support deep and shallow merge strategies
 * - Handle composite merges (marker-based)
 * - Enable accurate comparison between workspace and source for merged files
 * 
 * @module save-merge-extractor
 */

import { logger } from '../../utils/logger.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import type { SaveCandidate } from './save-types.js';

/**
 * Extract result with extracted content and hash
 */
export interface ExtractResult {
  success: boolean;
  extractedContent?: string;
  extractedHash?: string;
  error?: string;
}

/**
 * Extract package-specific contribution from a merged workspace file
 * 
 * This function reverses the merge operation that occurred during installation,
 * extracting only the keys/content that were contributed by the package.
 * 
 * For deep/shallow merges:
 * - Parses workspace file as JSON
 * - Extracts only the keys specified in mergeKeys
 * - Normalizes keys to extract at the appropriate level
 * - Returns serialized JSON of just those keys
 * 
 * For composite merges:
 * - Not yet implemented (returns error)
 * - Would need to extract content between package markers
 * 
 * **Key Normalization**: The workspace index may track leaf keys like
 * `mcp.github.type`, `mcp.github.url`, but we need to extract at the
 * parent level `mcp.github`. This function automatically finds the
 * common parent key to extract.
 * 
 * @param candidate - Workspace candidate with merge metadata
 * @returns Extract result with extracted content and hash
 */
export async function extractPackageContribution(
  candidate: SaveCandidate
): Promise<ExtractResult> {
  // Only applicable to workspace candidates with merge metadata
  if (candidate.source !== 'workspace') {
    return {
      success: false,
      error: 'Extract only applies to workspace candidates'
    };
  }
  
  if (!candidate.mergeStrategy || !candidate.mergeKeys || candidate.mergeKeys.length === 0) {
    return {
      success: false,
      error: 'No merge metadata present'
    };
  }
  
  const { mergeStrategy, mergeKeys, content } = candidate;
  
  try {
    switch (mergeStrategy) {
      case 'deep':
      case 'shallow':
        // Normalize keys to find the common parent
        const normalizedKeys = normalizeKeysToParent(mergeKeys);
        return await extractFromJsonMerge(content, normalizedKeys);
      
      case 'composite':
        return {
          success: false,
          error: 'Composite merge extraction not yet implemented'
        };
      
      case 'replace':
        // Replace strategy doesn't merge, so extraction not applicable
        return {
          success: false,
          error: 'Replace strategy does not require extraction'
        };
      
      default:
        return {
          success: false,
          error: `Unknown merge strategy: ${mergeStrategy}`
        };
    }
  } catch (error) {
    logger.debug(`Failed to extract package contribution: ${error}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Extract content by merge keys from raw JSON content (non-candidate)
 *
 * Used to compare a workspace merged contribution to the corresponding
 * subset of the local source content.
 *
 * @param content - JSON content string
 * @param mergeKeys - Dot-notation keys to extract
 * @returns Extract result with extracted content and hash
 */
export async function extractContentByKeys(
  content: string,
  mergeKeys: string[]
): Promise<ExtractResult> {
  try {
    const normalizedKeys = normalizeKeysToParent(mergeKeys);
    return await extractFromJsonMerge(content, normalizedKeys);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Normalize tracked keys to find the common parent keys to extract
 * 
 * During installation, the flow may track all leaf keys that were added:
 * - `mcpServers.github.type`
 * - `mcpServers.github.url`
 * - `mcpServers.github.headers.Authorization`
 * 
 * But for extraction, we want to extract at the parent level: `mcpServers.github`
 * 
 * However, if keys are already at the parent level (e.g., `mcp.github`, `mcp.gitlab`),
 * we should use them as-is without further normalization.
 * 
 * Algorithm:
 * 1. If all keys are already 2 levels deep or less, use them as-is
 * 2. Otherwise, find the longest common prefix and extract unique parent keys
 * 3. For leaf keys like `mcp.github.type`, `mcp.github.url`, extract `mcp.github`
 * 
 * @param keys - Array of tracked keys (may be leaf keys)
 * @returns Array of normalized parent keys to extract
 */
function normalizeKeysToParent(keys: string[]): string[] {
  if (keys.length === 0) return [];
  
  // Check if all keys are already at parent level (2 segments or less)
  const allAtParentLevel = keys.every(key => key.split('.').length <= 2);
  if (allAtParentLevel) {
    // Keys are already at the right level - use them as-is
    logger.debug(
      `Keys already at parent level - using as-is`,
      { keys }
    );
    return keys;
  }
  
  if (keys.length === 1) {
    // Single key - extract first 2 levels if possible
    const parts = keys[0].split('.');
    if (parts.length >= 2) {
      return [parts.slice(0, 2).join('.')];
    }
    return keys;
  }
  
  // Find the longest common prefix
  const firstParts = keys[0].split('.');
  let commonDepth = 0;
  
  for (let depth = 0; depth < firstParts.length; depth++) {
    const segment = firstParts[depth];
    const allMatch = keys.every(key => {
      const parts = key.split('.');
      return parts.length > depth && parts[depth] === segment;
    });
    
    if (allMatch) {
      commonDepth = depth + 1;
    } else {
      break;
    }
  }
  
  // Extract unique parent keys at the appropriate depth
  // For leaf keys, extract at 2 levels (or common depth if deeper)
  const normalized = new Set<string>();
  for (const key of keys) {
    const parts = key.split('.');
    // Use minimum of 2 levels or common depth + 1 (one level after common)
    const targetDepth = Math.max(2, commonDepth + 1);
    const extractDepth = Math.min(targetDepth, parts.length);
    
    if (extractDepth >= 2) {
      normalized.add(parts.slice(0, extractDepth).join('.'));
    } else if (parts.length > 0) {
      // Fallback: use the key as-is
      normalized.add(key);
    }
  }
  
  const result = Array.from(normalized);
  
  logger.debug(
    `Normalized ${keys.length} tracked keys to ${result.length} extraction key(s)`,
    { original: keys, normalized: result }
  );
  
  return result;
}

/**
 * Extract specific keys from a JSON-merged file
 * 
 * Given a JSON file that was merged during installation, extract only
 * the keys that were contributed by the package.
 * 
 * The mergeKeys use dot notation to specify nested keys:
 * - "mcp.github" means extract data.mcp.github
 * - "mcp.server1" means extract data.mcp.server1
 * - etc.
 * 
 * @param content - Full merged file content (JSON string)
 * @param mergeKeys - Array of dot-notation keys to extract
 * @returns Extract result with extracted content
 */
async function extractFromJsonMerge(
  content: string,
  mergeKeys: string[]
): Promise<ExtractResult> {
  try {
    // Parse the merged content
    const merged = JSON.parse(content);
    
    // Build an object containing only the package's keys
    const extracted: any = {};
    
    for (const keyPath of mergeKeys) {
      const value = getNestedValue(merged, keyPath);
      if (value !== undefined) {
        setNestedValue(extracted, keyPath, value);
      }
    }
    
    // Serialize the extracted content
    // Use same formatting as JSON.stringify with 2-space indent to match
    // how files are typically formatted
    const extractedContent = JSON.stringify(extracted, null, 2) + '\n';
    const extractedHash = await calculateFileHash(extractedContent);
    
    logger.debug(
      `Extracted ${mergeKeys.length} key(s) from merged file`,
      { keys: mergeKeys }
    );
    
    return {
      success: true,
      extractedContent,
      extractedHash
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get nested value from object using dot notation
 * 
 * @param obj - Object to traverse
 * @param keyPath - Dot-notation key path (e.g., "mcp.github")
 * @returns Value at the path, or undefined if not found
 */
function getNestedValue(obj: any, keyPath: string): any {
  const keys = keyPath.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[key];
  }
  
  return current;
}

/**
 * Set nested value in object using dot notation
 * 
 * Creates intermediate objects as needed.
 * 
 * @param obj - Object to modify
 * @param keyPath - Dot-notation key path (e.g., "mcp.github")
 * @param value - Value to set
 */
function setNestedValue(obj: any, keyPath: string, value: any): void {
  const keys = keyPath.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}
