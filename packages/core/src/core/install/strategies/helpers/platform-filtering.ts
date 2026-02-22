/**
 * Platform Filtering Helpers Module
 * 
 * Utilities for filtering source files based on platform specificity.
 */

import { basename } from 'path';
import type { Flow } from '../../../../types/flows.js';
import type { Platform } from '../../../platforms.js';
import {
  buildOverrideMap,
  shouldSkipUniversalFile,
  isPlatformSpecificFileForTarget
} from '../../../flows/platform-suffix-handler.js';
import { isPlatformId } from '../../../platforms.js';

/**
 * Filter flow sources by platform, removing files not applicable to target platform
 * 
 * @param flowSources - Map of flows to source file paths
 * @param platform - Target platform
 * @returns Filtered map with only applicable sources
 */
export function filterSourcesByPlatform(
  flowSources: Map<Flow, string[]>,
  platform: Platform
): Map<Flow, string[]> {
  const filtered = new Map<Flow, string[]>();
  
  // Build override map once for all sources
  const allSources: string[] = [];
  for (const sources of flowSources.values()) {
    allSources.push(...sources);
  }
  const overrideMap = buildOverrideMap(allSources);
  
  for (const [flow, sources] of flowSources) {
    const filteredSourcesForFlow: string[] = [];
    
    for (const sourceRel of sources) {
      // Skip platform-specific files not for this platform
      if (!isPlatformSpecificFileForTarget(sourceRel, platform) && 
          sourceRel.includes('.') && 
          sourceRel.split('.').length >= 3) {
        const parts = basename(sourceRel).split('.');
        const possiblePlatform = parts[parts.length - 2];
        if (possiblePlatform !== platform && isPlatformId(possiblePlatform)) {
          continue;
        }
      }
      
      // Skip universal files with platform overrides
      if (shouldSkipUniversalFile(sourceRel, platform, allSources, overrideMap)) {
        continue;
      }
      
      filteredSourcesForFlow.push(sourceRel);
    }
    
    if (filteredSourcesForFlow.length > 0) {
      filtered.set(flow, filteredSourcesForFlow);
    }
  }
  
  return filtered;
}

/**
 * Re-export utilities for convenience
 */
export { buildOverrideMap, shouldSkipUniversalFile, isPlatformSpecificFileForTarget };
