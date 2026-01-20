import { join, relative } from 'path';
import { readTextFile, walkFiles } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { isJunk } from 'junk';
import type { Package, PackageFile, PackageYml, PackageWithContext } from '../../types/index.js';
import { detectPackageFormat } from './format-detector.js';
import { DIR_PATTERNS } from '../../constants/index.js';
import { generatePluginName } from '../../utils/plugin-naming.js';
import { createPlatformContext } from '../conversion-context/index.js';
import { resolvePluginMetadata, type ClaudePluginManifest } from './plugin-metadata-resolver.js';
import type { MarketplacePluginEntry } from './marketplace-handler.js';

/**
 * In-memory cache for transformed plugin packages with context.
 * Key: `${packageName}@${version}`
 */
const transformedPluginCache = new Map<string, PackageWithContext>();

/**
 * Cache a transformed plugin package with context for later retrieval.
 */
export function cacheTransformedPlugin(pkg: Package, context?: any): void {
  const key = `${pkg.metadata.name}@${pkg.metadata.version}`;
  const cached: PackageWithContext = context 
    ? { package: pkg, context }
    : { package: pkg, context: createPlatformContext('claude-plugin', 1.0) };
  transformedPluginCache.set(key, cached);
  logger.debug('Cached transformed plugin', { name: pkg.metadata.name, version: pkg.metadata.version });
}

/**
 * Retrieve a cached transformed plugin package with context.
 */
export function getTransformedPlugin(name: string, version: string): PackageWithContext | undefined {
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
 * Context for transforming a plugin with naming information.
 */
export interface PluginTransformContext {
  gitUrl?: string;
  subdirectory?: string;
  repoPath?: string;
  marketplaceEntry?: MarketplacePluginEntry;
  marketplaceName?: string;  // Name of the marketplace (for proper scoping)
}

/**
 * Transform a Claude Code plugin to an OpenPackage Package with conversion context.
 * 
 * Resolves plugin metadata from plugin.json or marketplace entry, converts it to
 * OpenPackage format, and collects all plugin files.
 * 
 * @param pluginDir - Absolute path to plugin directory
 * @param context - Optional context for scoped naming and marketplace entry
 * @returns Package object with conversion context
 */
export async function transformPluginToPackage(
  pluginDir: string,
  context?: PluginTransformContext
): Promise<PackageWithContext> {
  logger.debug('Transforming Claude Code plugin to OpenPackage format', { 
    pluginDir, 
    context,
    hasMarketplaceEntry: !!context?.marketplaceEntry
  });
  
  // Resolve plugin metadata from plugin.json or marketplace entry
  const resolved = await resolvePluginMetadata(pluginDir, context?.marketplaceEntry);
  const pluginManifest = resolved.manifest;
  
  logger.debug('Resolved plugin metadata', {
    source: resolved.source,
    pluginName: pluginManifest.name
  });
  
  // Generate scoped name using consistent naming logic
  // Always generate the name (no override) to ensure consistency
  const packageName = generatePluginName({
    gitUrl: context?.gitUrl,
    subdirectory: context?.subdirectory,
    pluginManifestName: pluginManifest.name,
    marketplaceName: context?.marketplaceName,
    repoPath: context?.repoPath
  });
  
  logger.debug('Generated plugin name', { 
    original: pluginManifest.name, 
    scoped: packageName,
    hasGitContext: !!context?.gitUrl,
    hasSubdirectory: !!context?.subdirectory,
    hasMarketplaceName: !!context?.marketplaceName
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
  
  // Extract repository - handle both string and object forms
  if (pluginManifest.repository) {
    if (typeof pluginManifest.repository === 'string') {
      metadata.repository = {
        type: 'git',
        url: pluginManifest.repository
      };
    } else if (pluginManifest.repository.url) {
      metadata.repository = {
        type: pluginManifest.repository.type || 'git',
        url: pluginManifest.repository.url
      };
    }
  }
  
  // Collect all plugin files (preserve entire directory structure)
  const files = await extractPluginFiles(pluginDir);
  
  // Detect package format
  // Claude plugins are detected as platform-specific 'claude-plugin' format
  // and will use the claude-plugin flows defined in platforms.jsonc
  const format = detectPackageFormat(files);
  
  const pkg: Package = {
    metadata,
    files,
    // Store format metadata for installation pipeline
    _format: format
  };
  
  // Create conversion context for claude-plugin
  const conversionContext = createPlatformContext('claude-plugin', format.confidence);
  
  // Cache the transformed plugin with context for later retrieval
  cacheTransformedPlugin(pkg, conversionContext);
  
  logger.info('Transformed Claude Code plugin', {
    name: metadata.name,
    version: metadata.version,
    fileCount: files.length,
    format: format.type,
    platform: format.platform,
    confidence: format.confidence
  });
  
  return { package: pkg, context: conversionContext };
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
