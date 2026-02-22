import { join, relative } from 'path';
import { readTextFile, walkFiles } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { isJunk } from 'junk';
import type { Package, PackageFile, PackageYml, PackageWithContext } from '../../types/index.js';
import { detectPackageFormat } from './format-detector.js';
import { DIR_PATTERNS } from '../../constants/index.js';
import { generateGitHubPackageName } from '../../utils/plugin-naming.js';
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
function cacheTransformedPlugin(pkg: Package, context?: any): void {
  const key = `${pkg.metadata.name}@${pkg.metadata.version}`;
  const cached: PackageWithContext = context 
    ? { package: pkg, context }
    : { package: pkg, context: createPlatformContext('claude-plugin', 1.0) };
  transformedPluginCache.set(key, cached);
}

/**
 * Retrieve a cached transformed plugin package with context.
 */
export function getTransformedPlugin(name: string, version: string): PackageWithContext | undefined {
  const key = `${name}@${version}`;
  return transformedPluginCache.get(key);
}

/**
 * Context for transforming a plugin with naming information.
 */
interface PluginTransformContext {
  gitUrl?: string;
  path?: string;
  resourcePath?: string;
  repoPath?: string;
  marketplaceEntry?: MarketplacePluginEntry;
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
  // Resolve plugin metadata from plugin.json or marketplace entry
  const resolved = await resolvePluginMetadata(pluginDir, context?.marketplaceEntry);
  const pluginManifest = resolved.manifest;
  
  // Generate scoped name using consistent naming logic
  // Always generate the name (no override) to ensure consistency
  const packageName = generateGitHubPackageName({
    gitUrl: context?.gitUrl,
    path: context?.path,
    resourcePath: context?.resourcePath,
    packageName: pluginManifest.name,
    repoPath: context?.repoPath
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
async function extractPluginFiles(pluginDir: string): Promise<PackageFile[]> {
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
    
    return files;
    
  } catch (error) {
    throw new ValidationError(
      `Failed to extract files from plugin directory ${pluginDir}: ${error}`
    );
  }
}


