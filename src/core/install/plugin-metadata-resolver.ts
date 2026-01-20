import { join } from 'path';
import { exists, readTextFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { CLAUDE_PLUGIN_PATHS } from '../../constants/index.js';
import type { MarketplacePluginEntry } from './marketplace-handler.js';

/**
 * Claude Code plugin manifest schema (from plugin.json)
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
  repository?: string | {
    type?: string;
    url?: string;
  };
  license?: string;
  keywords?: string[];
  // Component configuration
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | object;
  mcpServers?: string | object;
  lspServers?: string | object;
}

/**
 * Metadata resolution result with source information
 */
export interface ResolvedPluginMetadata {
  /** Resolved plugin manifest */
  manifest: ClaudePluginManifest;
  /** Source of metadata */
  source: 'plugin.json' | 'marketplace' | 'merged';
}

/**
 * Resolve plugin metadata from multiple sources with priority handling.
 * 
 * Resolution logic:
 * 1. Check if plugin.json exists
 * 2. If exists AND strict !== false:
 *    - Use plugin.json as primary
 *    - Merge marketplace entry fields (as defaults)
 *    - Return with source: 'merged'
 * 3. If exists AND strict === false:
 *    - Log warning (misconfiguration - strict:false but plugin.json exists)
 *    - Use plugin.json anyway (safest fallback)
 *    - Return with source: 'plugin.json'
 * 4. If NOT exists AND strict === false:
 *    - Use marketplace entry as full definition
 *    - Return with source: 'marketplace'
 * 5. If NOT exists AND strict !== false:
 *    - Throw error (plugin.json required)
 * 
 * @param pluginDir - Absolute path to plugin directory
 * @param marketplaceEntry - Optional marketplace entry for this plugin
 * @returns Resolved metadata and source
 * @throws ValidationError if plugin.json is required but missing or invalid
 */
export async function resolvePluginMetadata(
  pluginDir: string,
  marketplaceEntry?: MarketplacePluginEntry
): Promise<ResolvedPluginMetadata> {
  logger.debug('Resolving plugin metadata', { pluginDir, hasMarketplaceEntry: !!marketplaceEntry });
  
  const manifestPath = join(pluginDir, CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST);
  const hasPluginJson = await exists(manifestPath);
  const isStrictFalse = marketplaceEntry?.strict === false;
  
  // Case 1 & 2: plugin.json exists
  if (hasPluginJson) {
    let pluginManifest: ClaudePluginManifest;
    
    try {
      const content = await readTextFile(manifestPath);
      pluginManifest = JSON.parse(content);
    } catch (error) {
      throw new ValidationError(
        `Failed to parse plugin manifest at ${manifestPath}: ${error}`
      );
    }
    
    // Case 2: strict:false but plugin.json exists (misconfiguration)
    if (isStrictFalse) {
      logger.warn(
        `Plugin at '${pluginDir}' has strict:false in marketplace but contains plugin.json. ` +
        `Using plugin.json as primary source. Consider removing plugin.json or setting strict:true.`
      );
      
      return {
        manifest: pluginManifest,
        source: 'plugin.json'
      };
    }
    
    // Case 1: strict is true or undefined - merge with marketplace entry
    if (marketplaceEntry) {
      const merged = mergePluginMetadata(pluginManifest, marketplaceEntry);
      logger.debug('Merged plugin.json with marketplace entry', { 
        pluginName: merged.name 
      });
      
      return {
        manifest: merged,
        source: 'merged'
      };
    }
    
    // No marketplace entry, just use plugin.json
    return {
      manifest: pluginManifest,
      source: 'plugin.json'
    };
  }
  
  // Case 4: No plugin.json, strict:false - use marketplace entry
  if (isStrictFalse && marketplaceEntry) {
    logger.debug('Using marketplace entry as full plugin definition (strict:false)', {
      pluginName: marketplaceEntry.name
    });
    
    const manifest = marketplaceEntryToManifest(marketplaceEntry);
    
    return {
      manifest,
      source: 'marketplace'
    };
  }
  
  // Case 5: No plugin.json and not strict:false - error
  if (marketplaceEntry) {
    throw new ValidationError(
      `Plugin '${marketplaceEntry.name}' at '${pluginDir}' is missing plugin.json. ` +
      `Either add .claude-plugin/plugin.json or set "strict": false in marketplace entry.`
    );
  } else {
    throw new ValidationError(
      `Plugin at '${pluginDir}' is missing plugin.json at ${CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST}`
    );
  }
}

/**
 * Merge plugin.json with marketplace entry.
 * Plugin.json fields take priority, marketplace entry provides defaults.
 */
function mergePluginMetadata(
  pluginManifest: ClaudePluginManifest,
  marketplaceEntry: MarketplacePluginEntry
): ClaudePluginManifest {
  return {
    name: pluginManifest.name, // Always use plugin.json name
    version: pluginManifest.version ?? marketplaceEntry.version,
    description: pluginManifest.description ?? marketplaceEntry.description,
    author: pluginManifest.author ?? marketplaceEntry.author,
    homepage: pluginManifest.homepage ?? marketplaceEntry.homepage,
    repository: pluginManifest.repository ?? marketplaceEntry.repository,
    license: pluginManifest.license ?? marketplaceEntry.license,
    keywords: pluginManifest.keywords ?? marketplaceEntry.keywords,
    commands: pluginManifest.commands ?? marketplaceEntry.commands,
    agents: pluginManifest.agents ?? marketplaceEntry.agents,
    hooks: pluginManifest.hooks ?? marketplaceEntry.hooks,
    mcpServers: pluginManifest.mcpServers ?? marketplaceEntry.mcpServers,
    lspServers: pluginManifest.lspServers ?? marketplaceEntry.lspServers,
  };
}

/**
 * Convert marketplace entry to plugin manifest (for strict:false plugins)
 */
function marketplaceEntryToManifest(entry: MarketplacePluginEntry): ClaudePluginManifest {
  return {
    name: entry.name,
    version: entry.version,
    description: entry.description,
    author: entry.author,
    homepage: entry.homepage,
    repository: entry.repository,
    license: entry.license,
    keywords: entry.keywords,
    commands: entry.commands,
    agents: entry.agents,
    hooks: entry.hooks,
    mcpServers: entry.mcpServers,
    lspServers: entry.lspServers,
  };
}
