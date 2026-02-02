/**
 * Base detection algorithm for resource-based installation.
 * 
 * Detects the "base" directory of a resource - the parent directory
 * that serves as the package root for installation flows.
 * 
 * Detection priority:
 * 1. openpackage.yml at resource root
 * 2. .claude-plugin/marketplace.json at resource root (triggers selection flow)
 * 3. .claude-plugin/plugin.json at resource root
 * 4. Pattern matching against platforms.jsonc (deepest match)
 */

import { join, resolve, dirname, relative, isAbsolute } from 'path';
import { exists } from '../../utils/fs.js';
import { extractAllFromPatterns, findDeepestMatch, type PatternMatch } from '../../utils/pattern-matcher.js';
import { logger } from '../../utils/logger.js';
import { FILE_PATTERNS, CLAUDE_PLUGIN_PATHS } from '../../constants/index.js';

/**
 * Result of base detection
 */
export interface BaseDetectionResult {
  /** Absolute path to detected base (undefined if no match) */
  base: string | undefined;
  
  /** The from pattern that matched (for pattern-based detection) */
  matchedPattern?: string;
  
  /** How the base was determined */
  matchType: 
    | 'openpackage'    // Found openpackage.yml
    | 'marketplace'    // Found marketplace.json (needs selection)
    | 'plugin'         // Found plugin.json
    | 'pattern'        // Matched from pattern
    | 'ambiguous'      // Multiple patterns at same depth
    | 'none';          // No match found
  
  /** For ambiguous cases, all possible matches */
  ambiguousMatches?: Array<{
    pattern: string;
    base: string;
    startIndex: number;
  }>;
  
  /** Path to marketplace manifest (for marketplace detection) */
  manifestPath?: string;
}

/**
 * Detect the base directory for a resource.
 * 
 * @param resourcePath - Path to the resource (relative to repoRoot, or absolute if filepath)
 * @param repoRoot - Root directory of the repository/package
 * @param platformsConfig - Platforms configuration object for pattern matching
 * @returns Base detection result
 */
export async function detectBase(
  resourcePath: string,
  repoRoot: string,
  platformsConfig: any
): Promise<BaseDetectionResult> {
  // Resolve absolute path to resource
  const absoluteResourcePath = isAbsolute(resourcePath) 
    ? resourcePath 
    : resolve(repoRoot, resourcePath);

  logger.debug('Detecting base for resource', {
    resourcePath,
    repoRoot,
    absoluteResourcePath
  });

  // Priority 1: openpackage.yml at resource root
  const openpackageYmlPath = join(absoluteResourcePath, FILE_PATTERNS.OPENPACKAGE_YML);
  if (await exists(openpackageYmlPath)) {
    logger.info('Base detected via openpackage.yml', { base: absoluteResourcePath });
    return {
      base: absoluteResourcePath,
      matchType: 'openpackage'
    };
  }

  // Priority 2: Marketplace manifest
  const marketplacePath = join(absoluteResourcePath, CLAUDE_PLUGIN_PATHS.MARKETPLACE_MANIFEST);
  if (await exists(marketplacePath)) {
    logger.info('Base detected via marketplace.json', { base: absoluteResourcePath });
    return {
      base: absoluteResourcePath,
      matchType: 'marketplace',
      manifestPath: marketplacePath
    };
  }

  // Priority 3: Individual plugin manifest
  const pluginPath = join(absoluteResourcePath, CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST);
  if (await exists(pluginPath)) {
    logger.info('Base detected via plugin.json', { base: absoluteResourcePath });
    return {
      base: absoluteResourcePath,
      matchType: 'plugin'
    };
  }

  // Priority 4: Pattern matching
  return detectBaseFromPatterns(resourcePath, repoRoot, platformsConfig);
}

/**
 * Detect base using pattern matching against platforms.jsonc.
 * 
 * @param resourcePath - Path to the resource (relative to repoRoot)
 * @param repoRoot - Root directory of the repository
 * @param platformsConfig - Platforms configuration object
 * @returns Base detection result
 */
async function detectBaseFromPatterns(
  resourcePath: string,
  repoRoot: string,
  platformsConfig: any
): Promise<BaseDetectionResult> {
  // Extract all patterns from platforms config
  const patterns = extractAllFromPatterns(platformsConfig);

  logger.debug('Pattern matching for base detection', {
    resourcePath,
    patternCount: patterns.length
  });

  // Match resource path against patterns
  const result = findDeepestMatch(resourcePath, patterns);

  if (!result) {
    logger.warn('No pattern matched for resource', { resourcePath });
    return {
      base: undefined,
      matchType: 'none'
    };
  }

  // Calculate absolute base path
  const basePath = result.match.basePath 
    ? resolve(repoRoot, result.match.basePath)
    : repoRoot;

  if (result.isAmbiguous && result.ambiguousMatches) {
    logger.info('Ambiguous base detected', {
      resourcePath,
      matchCount: result.ambiguousMatches.length,
      patterns: result.ambiguousMatches.map(m => m.pattern)
    });

    return {
      base: basePath,
      matchType: 'ambiguous',
      matchedPattern: result.match.pattern,
      ambiguousMatches: result.ambiguousMatches.map(m => ({
        pattern: m.pattern,
        base: m.basePath ? resolve(repoRoot, m.basePath) : repoRoot,
        startIndex: m.startIndex
      }))
    };
  }

  logger.info('Base detected via pattern matching', {
    resourcePath,
    base: basePath,
    pattern: result.match.pattern,
    startIndex: result.match.startIndex
  });

  return {
    base: basePath,
    matchedPattern: result.match.pattern,
    matchType: 'pattern'
  };
}

/**
 * Detect base for a file path source (local filesystem).
 * Similar to detectBase but handles local paths specially.
 * 
 * @param absolutePath - Absolute path to the resource
 * @param platformsConfig - Platforms configuration object
 * @returns Base detection result
 */
export async function detectBaseForFilepath(
  absolutePath: string,
  platformsConfig: any
): Promise<BaseDetectionResult> {
  // For file paths, we need to find the base by traversing up the directory tree
  // and checking each parent directory for manifest files or pattern matches

  let currentPath = absolutePath;
  const stat = await import('fs/promises').then(m => m.stat(absolutePath));
  
  // If it's a file, start from its directory
  if (!stat.isDirectory()) {
    currentPath = dirname(absolutePath);
  }

  // Check current directory for manifests
  const manifestResult = await checkForManifests(currentPath);
  if (manifestResult) {
    return manifestResult;
  }

  // Try pattern matching
  // For file paths, we need to extract a relative path structure to match against patterns
  // We'll traverse up the tree looking for a point where the remaining path matches a pattern
  
  return await detectBaseForFilepathViaPatterns(absolutePath, platformsConfig);
}

/**
 * Check a directory for manifest files.
 */
async function checkForManifests(dirPath: string): Promise<BaseDetectionResult | null> {
  // Check for openpackage.yml
  const openpackageYml = join(dirPath, FILE_PATTERNS.OPENPACKAGE_YML);
  if (await exists(openpackageYml)) {
    return {
      base: dirPath,
      matchType: 'openpackage'
    };
  }

  // Check for marketplace.json
  const marketplace = join(dirPath, CLAUDE_PLUGIN_PATHS.MARKETPLACE_MANIFEST);
  if (await exists(marketplace)) {
    return {
      base: dirPath,
      matchType: 'marketplace',
      manifestPath: marketplace
    };
  }

  // Check for plugin.json
  const plugin = join(dirPath, CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST);
  if (await exists(plugin)) {
    return {
      base: dirPath,
      matchType: 'plugin'
    };
  }

  return null;
}

/**
 * Detect base for a file path using pattern matching.
 * Traverses up the directory tree to find a matching pattern.
 */
async function detectBaseForFilepathViaPatterns(
  absolutePath: string,
  platformsConfig: any
): Promise<BaseDetectionResult> {
  const patterns = extractAllFromPatterns(platformsConfig);
  
  let currentPath = absolutePath;
  const stat = await import('fs/promises').then(m => m.stat(absolutePath));
  
  // If it's a file, start from its directory
  if (!stat.isDirectory()) {
    currentPath = dirname(absolutePath);
  }

  // Traverse up the directory tree
  let previousPath = '';
  while (currentPath !== previousPath) {
    // Build relative path from current directory to the resource
    const relativePath = relative(currentPath, absolutePath);
    
    if (!relativePath || relativePath === '.') {
      // Reached the resource itself
      previousPath = currentPath;
      currentPath = dirname(currentPath);
      continue;
    }

    // Try matching this relative path against patterns
    const result = findDeepestMatch(relativePath, patterns);
    
    if (result) {
      // Found a match!
      const basePath = result.match.basePath
        ? resolve(currentPath, result.match.basePath)
        : currentPath;

      if (result.isAmbiguous && result.ambiguousMatches) {
        return {
          base: basePath,
          matchType: 'ambiguous',
          matchedPattern: result.match.pattern,
          ambiguousMatches: result.ambiguousMatches.map(m => ({
            pattern: m.pattern,
            base: m.basePath ? resolve(currentPath, m.basePath) : currentPath,
            startIndex: m.startIndex
          }))
        };
      }

      return {
        base: basePath,
        matchedPattern: result.match.pattern,
        matchType: 'pattern'
      };
    }

    // Move up one directory
    previousPath = currentPath;
    currentPath = dirname(currentPath);
  }

  // No match found
  return {
    base: undefined,
    matchType: 'none'
  };
}
