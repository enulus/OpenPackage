/**
 * Pattern matching utilities for base detection.
 * 
 * Extracts patterns from platforms.jsonc and matches resource paths
 * against them using segment-indexed matching with deepest match resolution.
 */

import { minimatch } from 'minimatch';
import { logger } from './logger.js';

/**
 * A pattern match result
 */
export interface PatternMatch {
  /** The pattern that matched */
  pattern: string;
  
  /** Segment index where the match begins (0-based) */
  startIndex: number;
  
  /** The matched portion of the path */
  matchedPath: string;
  
  /** The base portion (everything before the match) */
  basePath: string;
}

/**
 * Extract all "from" patterns from a platforms configuration object.
 * 
 * @param platformsConfig - The platforms.jsonc configuration object
 * @returns Array of unique patterns
 */
export function extractAllFromPatterns(platformsConfig: any): string[] {
  const patterns = new Set<string>();

  // Global flows
  if (platformsConfig.global?.export) {
    for (const flow of platformsConfig.global.export) {
      addFlowPatterns(flow.from, patterns);
    }
  }

  // Platform-specific flows
  for (const [key, value] of Object.entries(platformsConfig)) {
    if (key === 'global' || key === '$schema') continue;
    
    const platformDef = value as any;
    if (platformDef.export) {
      for (const flow of platformDef.export) {
        addFlowPatterns(flow.from, patterns);
      }
    }
  }

  return Array.from(patterns);
}

/**
 * Add patterns from a flow's "from" field.
 * Handles string, array, and $switch expressions.
 */
function addFlowPatterns(from: any, patterns: Set<string>): void {
  if (typeof from === 'string') {
    patterns.add(from);
  } else if (Array.isArray(from)) {
    for (const p of from) {
      if (typeof p === 'string') {
        patterns.add(p);
      }
    }
  } else if (typeof from === 'object' && from.$switch) {
    // Handle $switch expressions - extract patterns from cases
    if (from.$switch.cases) {
      for (const c of from.$switch.cases) {
        if (typeof c.value === 'string') {
          patterns.add(c.value);
        } else if (Array.isArray(c.value)) {
          for (const v of c.value) {
            if (typeof v === 'string') {
              patterns.add(v);
            }
          }
        }
      }
    }
    if (from.$switch.default) {
      if (typeof from.$switch.default === 'string') {
        patterns.add(from.$switch.default);
      }
    }
  }
}

/**
 * Match a resource path against an array of patterns.
 * Returns all matches with their segment indices.
 * 
 * @param resourcePath - The path to match (e.g., "plugins/ui/agents/designer.md")
 * @param patterns - Array of glob patterns to match against
 * @returns Array of pattern matches
 */
export function matchPatterns(resourcePath: string, patterns: string[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  
  // Normalize path: remove leading/trailing slashes, split into segments
  const normalizedPath = resourcePath.replace(/^\/+|\/+$/g, '');
  const segments = normalizedPath.split('/').filter(s => s.length > 0);
  
  if (segments.length === 0) {
    return matches;
  }

  // Try matching each pattern
  for (const pattern of patterns) {
    // Normalize pattern
    const normalizedPattern = pattern.replace(/^\/+|\/+$/g, '');
    const patternSegments = normalizedPattern.split('/').filter(s => s.length > 0);
    
    if (patternSegments.length === 0) continue;

    // Try matching the pattern starting at each segment index
    for (let startIndex = 0; startIndex < segments.length; startIndex++) {
      const candidatePath = segments.slice(startIndex).join('/');
      
      // Use minimatch to test if the candidate path matches the pattern
      if (minimatch(candidatePath, normalizedPattern, { dot: true })) {
        const basePath = startIndex > 0 ? segments.slice(0, startIndex).join('/') : '';
        
        matches.push({
          pattern: normalizedPattern,
          startIndex,
          matchedPath: candidatePath,
          basePath
        });
        
        // Only record the first (earliest) match for this pattern
        break;
      }
    }
  }

  logger.debug('Pattern matching results', {
    resourcePath: normalizedPath,
    matchCount: matches.length,
    matches: matches.map(m => ({
      pattern: m.pattern,
      startIndex: m.startIndex,
      basePath: m.basePath
    }))
  });

  return matches;
}

/**
 * Select the deepest match from an array of pattern matches.
 * 
 * The deepest match is the one with the highest startIndex
 * (i.e., the pattern that matches furthest from the root).
 * 
 * If multiple patterns match at the same depth, returns all of them
 * as ambiguous matches.
 * 
 * @param matches - Array of pattern matches
 * @returns Object with deepest match(es) and whether it's ambiguous
 */
export function selectDeepestMatch(matches: PatternMatch[]): {
  match: PatternMatch;
  isAmbiguous: boolean;
  ambiguousMatches?: PatternMatch[];
} {
  if (matches.length === 0) {
    throw new Error('Cannot select deepest match from empty array');
  }

  if (matches.length === 1) {
    return {
      match: matches[0],
      isAmbiguous: false
    };
  }

  // Find the maximum start index
  const maxStartIndex = Math.max(...matches.map(m => m.startIndex));
  
  // Get all matches at that depth
  const deepestMatches = matches.filter(m => m.startIndex === maxStartIndex);
  
  if (deepestMatches.length === 1) {
    return {
      match: deepestMatches[0],
      isAmbiguous: false
    };
  }

  // Multiple matches at the same depth - ambiguous
  return {
    match: deepestMatches[0], // Return first as default
    isAmbiguous: true,
    ambiguousMatches: deepestMatches
  };
}

/**
 * Match a resource path and return the deepest match.
 * This is a convenience function that combines matchPatterns and selectDeepestMatch.
 * 
 * @param resourcePath - The path to match
 * @param patterns - Array of glob patterns
 * @returns Deepest match result, or null if no matches
 */
export function findDeepestMatch(
  resourcePath: string,
  patterns: string[]
): {
  match: PatternMatch;
  isAmbiguous: boolean;
  ambiguousMatches?: PatternMatch[];
} | null {
  const matches = matchPatterns(resourcePath, patterns);
  
  if (matches.length === 0) {
    return null;
  }

  return selectDeepestMatch(matches);
}
