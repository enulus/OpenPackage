/**
 * Flow Source Discovery
 * 
 * Discovers source files that match flow patterns.
 * Handles glob patterns, {name} placeholders, and priority-based pattern matching.
 */

import { promises as fs } from 'fs';
import { join, dirname, basename, relative } from 'path';
import { minimatch } from 'minimatch';
import type { Flow, FlowContext, SwitchExpression } from '../../types/flows.js';
import { exists } from '../../utils/fs.js';
import { getAllPlatforms } from '../platforms.js';
import type { Platform } from '../platforms.js';
import { logger } from '../../utils/logger.js';

/**
 * Discovery result for a single flow
 */
export interface FlowSourceDiscovery {
  flow: Flow;
  sources: string[];
}

/**
 * Discovery options
 */
export interface DiscoveryOptions {
  /**
   * Enable caching of pattern matches (default: false)
   */
  enableCache?: boolean;
  
  /**
   * Prefer dot-prefixed files for root-level patterns (default: true)
   * When true, checks .mcp.json before mcp.jsonc
   */
  preferDotPrefixed?: boolean;
  
  /**
   * Include platform-specific file variants (default: true)
   */
  includePlatformVariants?: boolean;
}

/**
 * Discover source files that match flow patterns
 * 
 * @param flows - Flows to discover sources for
 * @param packageRoot - Package root directory
 * @param context - Flow execution context
 * @param options - Discovery options
 * @returns Map of flow to discovered source paths
 */
export async function discoverFlowSources(
  flows: Flow[],
  packageRoot: string,
  context: FlowContext,
  options: DiscoveryOptions = {}
): Promise<Map<Flow, string[]>> {
  const flowSources = new Map<Flow, string[]>();
  const {
    preferDotPrefixed = true,
    includePlatformVariants = true
  } = options;
  
  for (const flow of flows) {
    // Handle array patterns: check all patterns, not just the first
    const patterns = Array.isArray(flow.from) ? flow.from : [flow.from];
    const allSourcePaths = new Set<string>();
    
    // Track dot-prefixed files found to avoid duplicates
    const dotPrefixedPathsFound = new Set<string>();
    const dotPrefixedBaseNames = new Set<string>();
    
    // First pass: check for dot-prefixed variants (if enabled)
    if (preferDotPrefixed) {
      for (const pattern of patterns) {
        const sourcePattern = resolvePattern(pattern, context);
        
        // Check for dot-prefixed variants for root-level files only
        if (!sourcePattern.includes('/') && !sourcePattern.startsWith('.')) {
          const dotPrefixedPattern = `.${sourcePattern}`;
          const dotPrefixedPaths = await matchPattern(dotPrefixedPattern, packageRoot);
          
          for (const path of dotPrefixedPaths) {
            dotPrefixedPathsFound.add(path);
            
            // Extract base name for similarity matching
            const baseName = path.replace(/^\./, '').split('.')[0];
            dotPrefixedBaseNames.add(baseName);
            allSourcePaths.add(path);
          }
        }
      }
    }
    
    // Second pass: check non-dot patterns
    for (const pattern of patterns) {
      const sourcePattern = resolvePattern(pattern, context);
      
      // Skip non-dot pattern if dot-prefixed variant with same base was found
      if (!sourcePattern.includes('/') && !sourcePattern.startsWith('.')) {
        const patternBaseName = sourcePattern.split('.')[0];
        if (dotPrefixedBaseNames.has(patternBaseName)) {
          continue;
        }
      }
      
      const sourcePaths = await matchPattern(sourcePattern, packageRoot);
      for (const path of sourcePaths) {
        allSourcePaths.add(path);
      }
    }
    
    flowSources.set(flow, Array.from(allSourcePaths));
  }
  
  return flowSources;
}

/**
 * Resolve pattern placeholders like {name}
 * 
 * Note: {name} is reserved for pattern matching and is NOT replaced
 * unless explicitly provided in the context variables via capturedName
 * 
 * @param pattern - Pattern with placeholders
 * @param context - Flow context with variables
 * @param capturedName - Captured {name} value (optional)
 * @returns Resolved pattern
 */
export function resolvePattern(
  pattern: string | SwitchExpression,
  context: FlowContext,
  capturedName?: string
): string {
  // Handle switch expressions
  if (typeof pattern === 'object' && '$switch' in pattern) {
    throw new Error('Cannot resolve SwitchExpression in resolvePattern - expression must be resolved first');
  }
  return pattern.replace(/{(\w+)}/g, (match, key) => {
    // If capturedName is provided and this is {name}, use the captured value
    if (key === 'name' && capturedName !== undefined) {
      return capturedName;
    }
    
    // Otherwise, reserve {name} for pattern matching - don't substitute it
    if (key === 'name') {
      return match;
    }
    
    if (key in context.variables) {
      return String(context.variables[key]);
    }
    
    return match;
  });
}

/**
 * Extract the captured {name} value from a source path that matched a pattern
 * 
 * @param sourcePath - Source path that matched
 * @param pattern - Pattern with {name} placeholder
 * @returns Captured name value, or undefined if no match
 * 
 * @example
 * extractCapturedName('rules/typescript.md', 'rules/{name}.md') // => 'typescript'
 */
export function extractCapturedName(sourcePath: string, pattern: string): string | undefined {
  // Convert pattern to regex with capture group for {name}
  const regexPattern = pattern
    .replace(/\{name\}/g, '([^/]+)')
    .replace(/\*/g, '.*')
    .replace(/\./g, '\\.');
  
  const regex = new RegExp('^' + regexPattern + '$');
  const match = sourcePath.match(regex);
  
  if (match && match[1]) {
    return match[1];
  }
  
  return undefined;
}

/**
 * Get the first pattern from a flow's from field
 * 
 * @param from - Flow from field (string, array, or switch expression)
 * @returns First pattern
 */
export function getFirstFromPattern(from: string | string[] | SwitchExpression): string {
  if (typeof from === 'object' && '$switch' in from) {
    throw new Error('Cannot get first pattern from SwitchExpression - expression must be resolved first');
  }
  return Array.isArray(from) ? from[0] : from;
}

/**
 * Match files against a pattern
 * 
 * Supports:
 * - Simple exact paths
 * - {name} placeholders
 * - * wildcards
 * - ** recursive globs
 * - Platform-specific variant discovery
 * 
 * @param pattern - Pattern to match
 * @param baseDir - Base directory to search in
 * @returns Array of matched file paths (relative to baseDir)
 */
export async function matchPattern(pattern: string, baseDir: string): Promise<string[]> {
  const matches: string[] = [];
  
  // Fast path: no wildcards/placeholders, check exact file and platform variants
  if (!pattern.includes('*') && !pattern.includes('{')) {
    const exactPath = join(baseDir, pattern);
    
    // Check for exact match
    if (await exists(exactPath)) {
      matches.push(relative(baseDir, exactPath));
    }
    
    // Also check for platform-specific variants
    const variants = await findPlatformVariants(exactPath, baseDir);
    matches.push(...variants);
    
    return matches;
  }
  
  // Globs: recursive walk with pattern matching
  const parts = pattern.split('/');
  const globPart = parts.findIndex(p => p.includes('*'));
  
  // No glob segment (e.g., {name}.md): scan the parent dir and filter
  if (globPart === -1) {
    const dirRel = dirname(pattern);
    const filePattern = basename(pattern);
    const searchDir = join(baseDir, dirRel);
    
    if (!(await exists(searchDir))) {
      return [];
    }
    
    const entries = await fs.readdir(searchDir, { withFileTypes: true });
    const regex = new RegExp(
      '^' +
        filePattern
          .replace(/\{name\}/g, '([^/]+)')
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*') +
        '$'
    );
    
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!regex.test(entry.name)) continue;
      matches.push(relative(baseDir, join(searchDir, entry.name)));
    }
    
    return matches;
  }
  
  // Pattern has glob segments
  const dirPath = join(baseDir, ...parts.slice(0, globPart));
  const filePattern = parts.slice(globPart).join('/');
  
  if (!(await exists(dirPath))) {
    return [];
  }
  
  await findMatchingFiles(dirPath, filePattern, baseDir, matches);
  return matches;
}

/**
 * Find platform-specific variants of a file
 * 
 * @param exactPath - Exact file path (absolute)
 * @param baseDir - Base directory for relative path calculation
 * @returns Array of platform-specific variant paths (relative to baseDir)
 */
async function findPlatformVariants(
  exactPath: string,
  baseDir: string
): Promise<string[]> {
  const matches: string[] = [];
  const dirPath = dirname(exactPath);
  const fileName = basename(exactPath);
  const nameParts = fileName.split('.');
  
  if (nameParts.length < 2 || !(await exists(dirPath))) {
    return matches;
  }
  
  // Get all known platforms
  const knownPlatforms = getAllPlatforms({ includeDisabled: true }) as readonly Platform[];
  
  // For each platform, check if a platform-specific variant exists
  const ext = nameParts[nameParts.length - 1];
  const baseName = nameParts.slice(0, -1).join('.');
  
  for (const platform of knownPlatforms) {
    const platformFileName = `${baseName}.${platform}.${ext}`;
    const platformPath = join(dirPath, platformFileName);
    
    if (await exists(platformPath)) {
      matches.push(relative(baseDir, platformPath));
    }
  }
  
  return matches;
}

/**
 * Recursively find files matching a pattern
 * 
 * @param dir - Directory to search in
 * @param pattern - Pattern to match (may contain globs)
 * @param baseDir - Base directory for relative path calculation
 * @param matches - Array to accumulate matches
 */
async function findMatchingFiles(
  dir: string,
  pattern: string,
  baseDir: string,
  matches: string[]
): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        await findMatchingFiles(fullPath, pattern, baseDir, matches);
      } else if (entry.isFile()) {
        const matched = minimatch(rel, pattern, { dot: false });
        if (matched) {
          matches.push(rel);
        }
      }
    }
  } catch (error) {
    // Ignore permission errors
    if ((error as NodeJS.ErrnoException).code !== 'EACCES' && 
        (error as NodeJS.ErrnoException).code !== 'EPERM') {
      logger.debug('Error reading directory during pattern matching', { dir, error });
    }
  }
}

/**
 * Batch discover sources for multiple flows
 * Returns flat array of all discoveries
 * 
 * @param flows - Flows to discover sources for
 * @param packageRoot - Package root directory
 * @param context - Flow execution context
 * @param options - Discovery options
 * @returns Array of flow source discoveries
 */
export async function batchDiscoverFlowSources(
  flows: Flow[],
  packageRoot: string,
  context: FlowContext,
  options: DiscoveryOptions = {}
): Promise<FlowSourceDiscovery[]> {
  const discoveries: FlowSourceDiscovery[] = [];
  const flowSourcesMap = await discoverFlowSources(flows, packageRoot, context, options);
  
  for (const [flow, sources] of flowSourcesMap) {
    discoveries.push({ flow, sources });
  }
  
  return discoveries;
}

/**
 * Count total discovered sources across all flows
 * 
 * @param flowSources - Map of flows to sources
 * @returns Total number of unique source files
 */
export function countDiscoveredSources(flowSources: Map<Flow, string[]>): number {
  const allSources = new Set<string>();
  
  for (const sources of flowSources.values()) {
    for (const source of sources) {
      allSources.add(source);
    }
  }
  
  return allSources.size;
}
