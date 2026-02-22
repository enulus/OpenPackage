/**
 * Source Pattern Resolver
 * 
 * Resolves source file patterns (including arrays with priority) to actual file paths.
 * Supports glob patterns and priority-based pattern selection.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
import * as fsUtils from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

/**
 * Result of source pattern resolution
 */
export interface SourceResolutionResult {
  /** Resolved file paths that matched */
  paths: string[];
  
  /** Warnings generated during resolution */
  warnings: string[];
  
  /** Pattern that matched (for multi-pattern scenarios) */
  matchedPattern?: string;
  
  /** Patterns that were skipped due to lower priority */
  skippedPatterns?: string[];
}

/**
 * Options for source resolution
 */
export interface SourceResolutionOptions {
  /** Base directory for resolving relative patterns */
  baseDir: string;
  
  /** Whether to log warnings for skipped patterns */
  logWarnings?: boolean;
}

/**
 * Source Pattern Resolver
 * 
 * Handles resolution of single patterns, arrays of patterns (with priority),
 * and glob patterns to actual file paths.
 */
export class SourcePatternResolver {
  /**
   * Resolve source pattern(s) to file paths
   * 
   * For single patterns: returns all matching files
   * For array patterns: returns files from first matching pattern only (priority order)
   * 
   * @param pattern - Single pattern or array of patterns with priority
   * @param options - Resolution options
   * @returns Resolution result with paths and warnings
   */
  async resolve(
    pattern: string | string[],
    options: SourceResolutionOptions
  ): Promise<SourceResolutionResult> {
    // Handle array of patterns with priority
    if (Array.isArray(pattern)) {
      return this.resolveWithPriority(pattern, options);
    }
    
    // Single pattern
    const paths = await this.resolveSinglePattern(pattern, options.baseDir);
    return {
      paths,
      warnings: [],
    };
  }

  /**
   * Resolve array of patterns with priority (first match wins)
   * 
   * Iterates through patterns in order, returning files from first matching pattern.
   * Logs warnings if lower-priority patterns also match.
   * 
   * @param patterns - Array of patterns in priority order
   * @param options - Resolution options
   * @returns Resolution result
   */
  private async resolveWithPriority(
    patterns: string[],
    options: SourceResolutionOptions
  ): Promise<SourceResolutionResult> {
    if (patterns.length === 0) {
      return { paths: [], warnings: ['Empty pattern array provided'] };
    }

    const warnings: string[] = [];
    const skippedPatterns: string[] = [];

    // Try each pattern in priority order
    for (let i = 0; i < patterns.length; i++) {
      const currentPattern = patterns[i];
      const matches = await this.resolveSinglePattern(currentPattern, options.baseDir);

      if (matches.length > 0) {
        // Found matches - check if lower-priority patterns also match
        for (let j = i + 1; j < patterns.length; j++) {
          const lowerPriorityPattern = patterns[j];
          const lowerMatches = await this.resolveSinglePattern(
            lowerPriorityPattern,
            options.baseDir
          );

          if (lowerMatches.length > 0) {
            const warning = `Pattern "${currentPattern}" matched (priority ${i + 1}). ` +
              `Ignoring lower-priority pattern "${lowerPriorityPattern}" (priority ${j + 1}) ` +
              `which also matched ${lowerMatches.length} file(s).`;
            
            warnings.push(warning);
            skippedPatterns.push(lowerPriorityPattern);

            if (options.logWarnings !== false) {
              logger.debug(warning);
            }
          }
        }

        return {
          paths: matches,
          warnings,
          matchedPattern: currentPattern,
          skippedPatterns: skippedPatterns.length > 0 ? skippedPatterns : undefined,
        };
      }
    }

    // No patterns matched
    return {
      paths: [],
      warnings: [`No files matched any of the ${patterns.length} pattern(s): ${patterns.join(', ')}`],
    };
  }

  /**
   * Resolve a single pattern to file paths
   * 
   * Handles both glob patterns and literal file paths.
   * 
   * @param pattern - File pattern (may contain globs)
   * @param baseDir - Base directory for resolution
   * @returns Array of resolved file paths
   */
  private async resolveSinglePattern(pattern: string, baseDir: string): Promise<string[]> {
    // Check if pattern contains glob wildcard
    if (this.isGlobPattern(pattern)) {
      return this.resolveGlobPattern(pattern, baseDir);
    }

    // Literal file path - check if it exists
    const resolved = path.join(baseDir, pattern);
    const exists = await fsUtils.exists(resolved);

    return exists ? [resolved] : [];
  }

  /**
   * Check if pattern contains glob wildcards
   * 
   * @param pattern - Pattern to check
   * @returns True if pattern contains glob syntax
   */
  private isGlobPattern(pattern: string): boolean {
    return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
  }

  /**
   * Resolve glob pattern to matching files
   * 
   * @param pattern - Glob pattern
   * @param baseDir - Base directory
   * @returns Array of matching file paths
   */
  private async resolveGlobPattern(pattern: string, baseDir: string): Promise<string[]> {
    const matches: string[] = [];

    // Extract directory and file pattern
    const parts = pattern.split('/');
    const globPart = parts.findIndex(p => this.isGlobPattern(p));

    if (globPart === -1) {
      // No glob found (shouldn't happen, but handle gracefully)
      return [path.join(baseDir, pattern)];
    }

    // Build directory path up to first glob
    const dirPath = path.join(baseDir, ...parts.slice(0, globPart));
    const filePattern = parts.slice(globPart).join('/');

    // Check if directory exists
    if (!await fsUtils.exists(dirPath)) {
      return [];
    }

    // Recursively find matching files
    await this.findMatchingFiles(dirPath, filePattern, baseDir, matches);

    return matches;
  }

  /**
   * Recursively find files matching glob pattern
   * 
   * Supports ** for recursive directory matching.
   * 
   * @param dir - Current directory
   * @param pattern - Pattern to match
   * @param baseDir - Base directory for relative paths
   * @param matches - Array to accumulate matches
   */
  private async findMatchingFiles(
    dir: string,
    pattern: string,
    baseDir: string,
    matches: string[]
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        if (entry.isDirectory()) {
          // Always recurse for ** patterns
          if (pattern.startsWith('**') || pattern.includes('/**/')) {
            await this.findMatchingFiles(fullPath, pattern, baseDir, matches);
          } else if (pattern.includes('/')) {
            // For patterns with subdirs, continue searching
            await this.findMatchingFiles(fullPath, pattern, baseDir, matches);
          }
        } else if (entry.isFile()) {
          // Test file against pattern
          if (minimatch(relativePath, pattern, { dot: false })) {
            matches.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore errors (directory not accessible, etc.)
      logger.debug(`Error reading directory ${dir}: ${error}`);
    }
  }
}

/**
 * Create a source pattern resolver instance
 */
export function createSourceResolver(): SourcePatternResolver {
  return new SourcePatternResolver();
}
