import { join, relative } from 'path';
import { readTextFile, walkFiles } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { isJunk } from 'junk';
import type { Package, PackageFile, PackageYml } from '../../types/index.js';
import { detectPackageFormat } from './format-detector.js';
import { CLAUDE_PLUGIN_PATHS, DIR_PATTERNS } from '../../constants/index.js';
import { generatePluginName } from '../../utils/plugin-naming.js';

/**
 * In-memory cache for transformed plugin packages.
 * Key: `${packageName}@${version}`
 */
const transformedPluginCache = new Map<string, Package>();

/**
 * Cache a transformed plugin package for later retrieval.
 */
export function cacheTransformedPlugin(pkg: Package): void {
  const key = `${pkg.metadata.name}@${pkg.metadata.version}`;
  transformedPluginCache.set(key, pkg);
  logger.debug('Cached transformed plugin', { name: pkg.metadata.name, version: pkg.metadata.version });
}

/**
 * Retrieve a cached transformed plugin package.
 */
export function getTransformedPlugin(name: string, version: string): Package | undefined {
  const key = `${name}@${version}`;
  return transformedPluginCache.get(key);
}

/**
 * Clear the plugin cache (useful for testing).
 */
export function clearPluginCache(): void {
  transformedPluginCache.clear();
}

/**
 * Claude Code plugin manifest schema.
 * See: https://code.claude.com/docs/en/plugins-reference
 */
export interface ClaudePluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: {
    name?: string;
    email?: string;
    url?: string;
  };
  homepage?: string;
  repository?: {
    type?: string;
    url?: string;
  };
  license?: string;
  keywords?: string[];
}

/**
 * Context for transforming a plugin with naming information.
 */
export interface PluginTransformContext {
  gitUrl?: string;
  subdirectory?: string;
  repoPath?: string;
}

/**
 * Transform a Claude Code plugin to an OpenPackage Package.
 * 
 * Reads the plugin manifest (.claude-plugin/plugin.json), converts it to
 * OpenPackage format, and collects all plugin files.
 * 
 * @param pluginDir - Absolute path to plugin directory
 * @param context - Optional context for scoped naming (GitHub URL, subdirectory)
 * @returns Package object ready for installation
 */
export async function transformPluginToPackage(
  pluginDir: string,
  context?: PluginTransformContext
): Promise<Package> {
  logger.debug('Transforming Claude Code plugin to OpenPackage format', { pluginDir, context });
  
  // Read and parse plugin manifest
  const manifestPath = join(pluginDir, CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST);
  let pluginManifest: ClaudePluginManifest;
  
  try {
    const content = await readTextFile(manifestPath);
    pluginManifest = JSON.parse(content);
  } catch (error) {
    throw new ValidationError(
      `Failed to parse plugin manifest at ${manifestPath}: ${error}`
    );
  }
  
  // Generate scoped name if GitHub context is provided
  const packageName = generatePluginName({
    gitUrl: context?.gitUrl,
    subdirectory: context?.subdirectory,
    pluginManifestName: pluginManifest.name,
    repoPath: context?.repoPath
  });
  
  logger.debug('Generated plugin name', { 
    original: pluginManifest.name, 
    scoped: packageName 
  });
  
  // Transform to OpenPackage metadata
  const metadata: PackageYml = {
    name: packageName,
    // Claude Code plugins often omit version; normalize to a concrete value so:
    // - logs/install output are consistent
    // - transformed plugin cache keys remain stable
    version: pluginManifest.version?.trim() || '0.0.0',
    description: pluginManifest.description,
    keywords: pluginManifest.keywords,
    license: pluginManifest.license,
    homepage: pluginManifest.homepage
  };
  
  // Extract author name
  if (pluginManifest.author?.name) {
    metadata.author = pluginManifest.author.name;
  }
  
  // Extract repository
  if (pluginManifest.repository?.url) {
    metadata.repository = {
      type: pluginManifest.repository.type || 'git',
      url: pluginManifest.repository.url
    };
  }
  
  // Collect all plugin files (preserve entire directory structure)
  const files = await extractPluginFiles(pluginDir);
  
  // Detect package format for conversion hints
  const format = detectPackageFormat(files);
  
  // Claude plugins have universal structure but Claude-specific content (frontmatter)
  // Mark as native Claude format: needs path mapping but no content transformation
  // - isNativeFormat: true = content is already in target format (skip map/pipe transforms)
  // - nativePlatform: 'claude' = this content is designed for Claude platform
  // - platform: 'claude' = source format is Claude-specific
  // 
  // Installation behavior:
  // - Installing to claude: Use path mappings only (commands/ → .claude/commands/)
  // - Installing to other platforms: Full conversion (claude → universal → target)
  format.type = 'platform-specific';
  format.platform = 'claude';
  format.isNativeFormat = true;
  format.nativePlatform = 'claude';
  
  const pkg: Package = {
    metadata,
    files,
    // Store format metadata for installation pipeline
    _format: format
  };
  
  // Cache the transformed plugin for later retrieval
  cacheTransformedPlugin(pkg);
  
  logger.info('Transformed Claude Code plugin', {
    name: metadata.name,
    version: metadata.version,
    fileCount: files.length,
    format: format.type,
    platform: format.platform,
    confidence: format.confidence
  });
  
  return pkg;
}

/**
 * Extract all files from a plugin directory, preserving structure.
 * 
 * Plugin files are kept with their original paths (commands/, agents/, etc.)
 * The OpenPackage platform system will handle installing them to the correct
 * platform-specific directories (.claude/commands/, .cursor/commands/, etc.)
 * 
 * Special handling for plugin-specific files:
 * - .claude-plugin/ → skipped (plugin metadata, not needed in workspace)
 * - .mcp.json, .lsp.json → kept as root files
 * - commands/, agents/, skills/, hooks/ → universal subdirs
 * 
 * @param pluginDir - Absolute path to plugin directory
 * @returns Array of package files with original paths
 */
export async function extractPluginFiles(pluginDir: string): Promise<PackageFile[]> {
  const files: PackageFile[] = [];
  
  try {
    for await (const fullPath of walkFiles(pluginDir)) {
      const relativePath = relative(pluginDir, fullPath);
      
      // Skip junk files (e.g., .DS_Store, Thumbs.db)
      const pathParts = relativePath.split('/');
      if (pathParts.some(part => isJunk(part))) {
        continue;
      }
      
      // Skip git metadata
      if (relativePath.startsWith('.git/') || relativePath === '.git') {
        continue;
      }
      
      // Skip .claude-plugin directory (plugin metadata, not needed in workspace)
      if (relativePath.startsWith(`${DIR_PATTERNS.CLAUDE_PLUGIN}/`)) {
        continue;
      }
      
      const content = await readTextFile(fullPath);
      
      files.push({
        path: relativePath,
        content,
        encoding: 'utf8'
      });
    }
    
    logger.debug(`Extracted ${files.length} files from plugin`, { pluginDir });
    return files;
    
  } catch (error) {
    throw new ValidationError(
      `Failed to extract files from plugin directory ${pluginDir}: ${error}`
    );
  }
}

/**
 * Validate plugin structure by checking for expected directories.
 * This is a soft validation - missing directories are warnings, not errors.
 */
export function validatePluginStructure(files: PackageFile[]): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const paths = files.map(f => f.path);
  
  // Check for .claude-plugin directory
  const hasManifest = paths.some(p => p.startsWith(`${DIR_PATTERNS.CLAUDE_PLUGIN}/`));
  if (!hasManifest) {
    warnings.push(`Plugin is missing ${DIR_PATTERNS.CLAUDE_PLUGIN}/ directory`);
  }
  
  // Warn if no commands, agents, or skills (but this is valid)
  const hasCommands = paths.some(p => p.startsWith('commands/'));
  const hasAgents = paths.some(p => p.startsWith('agents/'));
  const hasSkills = paths.some(p => p.startsWith('skills/'));
  const hasHooks = paths.some(p => p.startsWith('hooks/'));
  const hasMcp = paths.some(p => p === '.mcp.json');
  const hasLsp = paths.some(p => p === '.lsp.json');
  
  if (!hasCommands && !hasAgents && !hasSkills && !hasHooks && !hasMcp && !hasLsp) {
    warnings.push(
      'Plugin does not contain any commands, agents, skills, hooks, MCP, or LSP configurations. ' +
      'It may be empty or incomplete.'
    );
  }
  
  return {
    valid: true,
    warnings
  };
}
