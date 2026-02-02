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

import { join, resolve, dirname, relative, isAbsolute, sep } from 'path';
import { exists, readTextFile } from '../../utils/fs.js';
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
  const repoRootResolved = resolve(repoRoot);

  logger.debug('Detecting base for resource', {
    resourcePath,
    repoRoot,
    absoluteResourcePath
  });

  // Determine whether resourcePath points to a file or directory.
  // If it's a file, manifests must be discovered by walking up from the file's directory.
  let probeStart = absoluteResourcePath;
  let statIsDir: boolean | null = null;
  let statIsFile: boolean | null = null;
  try {
    const stat = await import('fs/promises').then(m => m.stat(absoluteResourcePath));
    statIsDir = stat.isDirectory();
    statIsFile = stat.isFile();
    if (!stat.isDirectory()) {
      probeStart = dirname(absoluteResourcePath);
    }
  } catch {
    // If stat fails, keep probeStart as-is and fall back to patterns.
  }

  const isWithinRepo = (absPath: string): boolean => {
    if (absPath === repoRootResolved) return true;
    return absPath.startsWith(`${repoRootResolved}${sep}`);
  };

  // Track marketplace root (do not immediately return it for file-scoped resource installs)
  // so we can attempt resolving an individual plugin base first.
  let marketplaceRoot: { base: string; manifestPath: string } | null = null;

  // Priority 1-3: Walk up directories from probeStart to repoRoot, preferring the deepest match.
  // This allows file resources inside a marketplace repo to resolve to the specific plugin base
  // (plugin.json) before hitting the marketplace root.
  let currentDir = probeStart;
  let previousDir = '';
  while (currentDir !== previousDir && isWithinRepo(currentDir)) {
    // Priority 1: openpackage.yml
    const openpackageYmlPath = join(currentDir, FILE_PATTERNS.OPENPACKAGE_YML);
    if (await exists(openpackageYmlPath)) {
      logger.info('Base detected via openpackage.yml', { base: currentDir });
      return {
        base: currentDir,
        matchType: 'openpackage'
      };
    }

    // Priority 2: marketplace.json
    const marketplacePath = join(currentDir, CLAUDE_PLUGIN_PATHS.MARKETPLACE_MANIFEST);
    if (await exists(marketplacePath)) {
      logger.info('Base detected via marketplace.json', { base: currentDir });
      marketplaceRoot = { base: currentDir, manifestPath: marketplacePath };
    }

    // Priority 3: plugin.json
    const pluginPath = join(currentDir, CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST);
    if (await exists(pluginPath)) {
      logger.info('Base detected via plugin.json', { base: currentDir });
      return {
        base: currentDir,
        matchType: 'plugin'
      };
    }

    previousDir = currentDir;
    currentDir = dirname(currentDir);
  }

  // Marketplace-aware plugin base inference:
  // If this repo is a Claude marketplace AND the user provided a file/dir resource path within it,
  // try to resolve the plugin base from marketplace.json plugin entries (e.g. "./plugins/unit-testing").
  if (marketplaceRoot && resourcePath && !isAbsolute(resourcePath)) {
    try {
      const raw = await readTextFile(marketplaceRoot.manifestPath);
      const parsed = JSON.parse(raw) as { plugins?: Array<{ name?: string; source?: any; strict?: boolean }> };
      const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];

      const normalizeRel = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/^\/+/, '');
      const normalizedResource = normalizeRel(resourcePath);

      let bestMatch: { rel: string; pluginName?: string } | null = null;
      for (const p of plugins) {
        const source = (p as any)?.source;
        const relRaw = typeof source === 'string' ? source : undefined;
        if (!relRaw) continue;
        const rel = normalizeRel(relRaw);
        if (!rel) continue;
        if (normalizedResource === rel || normalizedResource.startsWith(`${rel}/`)) {
          if (!bestMatch || rel.length > bestMatch.rel.length) {
            bestMatch = { rel, pluginName: p?.name };
          }
        }
      }

      if (bestMatch) {
        const inferredBase = resolve(repoRootResolved, bestMatch.rel);
        logger.info('Base inferred from marketplace plugin entry', { base: inferredBase, plugin: bestMatch.pluginName, rel: bestMatch.rel });
        return {
          base: inferredBase,
          matchType: 'plugin'
        };
      }
    } catch (error) {
      // Ignore marketplace parsing issues; fall back to patterns/marketplace mode.
    }
  }

  // Priority 4: Pattern matching
  const patternResult = await detectBaseFromPatterns(resourcePath, repoRoot, platformsConfig);
  if (patternResult.matchType !== 'none') {
    return patternResult;
  }

  // Fallback: if we discovered a marketplace root and nothing else matched, return marketplace.
  if (marketplaceRoot) {
    return {
      base: marketplaceRoot.base,
      matchType: 'marketplace',
      manifestPath: marketplaceRoot.manifestPath
    };
  }

  return patternResult;
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
