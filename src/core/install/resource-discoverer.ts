/**
 * Resource Discovery Module
 * 
 * Discovers all installable resources within a package/plugin:
 * - Agents (agents/.../*.md)
 * - Skills (skills/.../ directories with SKILL.md)
 * - Commands (commands/.../*.md)
 * - Rules (rules/.../*.md)
 * - Hooks (hooks/.../)
 * - MCP servers (mcp.jsonc, mcp.json)
 */

import { join, basename, dirname, relative, resolve } from 'path';
import { walkFiles } from '../../utils/file-walker.js';
import { exists, readTextFile } from '../../utils/fs.js';
import { splitFrontmatter } from '../../utils/markdown-frontmatter.js';
import { logger } from '../../utils/logger.js';
import type { 
  DiscoveredResource, 
  ResourceDiscoveryResult,
  ResourceType 
} from './resource-types.js';

/**
 * Discover all installable resources within a package
 * 
 * @param basePath - Base path to search from (detectedBase or contentRoot)
 * @param repoRoot - Repository root path for relative path calculation
 * @returns Discovery result with all found resources
 */
export async function discoverResources(
  basePath: string,
  repoRoot: string
): Promise<ResourceDiscoveryResult> {
  logger.debug('Discovering resources', { basePath, repoRoot });
  
  const basePathResolved = resolve(basePath);
  const repoRootResolved = resolve(repoRoot);
  
  const allResources: DiscoveredResource[] = [];
  
  // Discover each resource type
  const agents = await discoverAgents(basePathResolved, repoRootResolved);
  const skills = await discoverSkills(basePathResolved, repoRootResolved);
  const commands = await discoverCommands(basePathResolved, repoRootResolved);
  const rules = await discoverRules(basePathResolved, repoRootResolved);
  const hooks = await discoverHooks(basePathResolved, repoRootResolved);
  const mcp = await discoverMCP(basePathResolved, repoRootResolved);
  
  allResources.push(...agents, ...skills, ...commands, ...rules, ...hooks, ...mcp);
  
  // Group by type
  const byType = new Map<ResourceType, DiscoveredResource[]>();
  for (const resource of allResources) {
    const existing = byType.get(resource.resourceType) || [];
    existing.push(resource);
    byType.set(resource.resourceType, existing);
  }
  
  logger.info('Resource discovery complete', {
    total: allResources.length,
    agents: agents.length,
    skills: skills.length,
    commands: commands.length,
    rules: rules.length,
    hooks: hooks.length,
    mcp: mcp.length
  });
  
  return {
    all: allResources,
    byType,
    total: allResources.length,
    basePath: basePathResolved,
    repoRoot: repoRootResolved
  };
}

/**
 * Discover agents (agents/.../*.md)
 */
async function discoverAgents(
  basePath: string,
  repoRoot: string
): Promise<DiscoveredResource[]> {
  const resources: DiscoveredResource[] = [];
  const agentsDir = join(basePath, 'agents');
  
  if (!(await exists(agentsDir))) {
    return resources;
  }
  
  for await (const file of walkFiles(agentsDir)) {
    if (!file.endsWith('.md')) {
      continue;
    }
    
    const metadata = await extractMarkdownMetadata(file);
    const resourcePath = normalizeResourcePath(file, repoRoot);
    
    resources.push({
      resourceType: 'agent',
      resourcePath,
      displayName: metadata.name || basename(file, '.md'),
      description: metadata.description,
      version: metadata.version,
      filePath: file,
      installKind: 'file',
      matchedBy: metadata.name ? 'frontmatter' : 'filename'
    });
  }
  
  return resources;
}

/**
 * Discover skills (skills/.../ directories with SKILL.md)
 */
async function discoverSkills(
  basePath: string,
  repoRoot: string
): Promise<DiscoveredResource[]> {
  const resources: DiscoveredResource[] = [];
  const skillsDir = join(basePath, 'skills');
  
  if (!(await exists(skillsDir))) {
    return resources;
  }
  
  for await (const file of walkFiles(skillsDir)) {
    if (basename(file) !== 'SKILL.md') {
      continue;
    }
    
    const skillDir = dirname(file);
    const metadata = await extractMarkdownMetadata(file);
    const resourcePath = normalizeResourcePath(skillDir, repoRoot);
    
    resources.push({
      resourceType: 'skill',
      resourcePath,
      displayName: metadata.name || basename(skillDir),
      description: metadata.description,
      version: metadata.version,
      filePath: skillDir,
      installKind: 'directory',
      matchedBy: metadata.name ? 'frontmatter' : 'dirname'
    });
  }
  
  return resources;
}

/**
 * Discover commands (commands/.../*.md)
 */
async function discoverCommands(
  basePath: string,
  repoRoot: string
): Promise<DiscoveredResource[]> {
  const resources: DiscoveredResource[] = [];
  const commandsDir = join(basePath, 'commands');
  
  if (!(await exists(commandsDir))) {
    return resources;
  }
  
  for await (const file of walkFiles(commandsDir)) {
    if (!file.endsWith('.md')) {
      continue;
    }
    
    const metadata = await extractMarkdownMetadata(file);
    const resourcePath = normalizeResourcePath(file, repoRoot);
    
    resources.push({
      resourceType: 'command',
      resourcePath,
      displayName: metadata.name || basename(file, '.md'),
      description: metadata.description,
      version: metadata.version,
      filePath: file,
      installKind: 'file',
      matchedBy: metadata.name ? 'frontmatter' : 'filename'
    });
  }
  
  return resources;
}

/**
 * Discover rules (rules/.../*.md)
 */
async function discoverRules(
  basePath: string,
  repoRoot: string
): Promise<DiscoveredResource[]> {
  const resources: DiscoveredResource[] = [];
  const rulesDir = join(basePath, 'rules');
  
  if (!(await exists(rulesDir))) {
    return resources;
  }
  
  for await (const file of walkFiles(rulesDir)) {
    if (!file.endsWith('.md')) {
      continue;
    }
    
    const metadata = await extractMarkdownMetadata(file);
    const resourcePath = normalizeResourcePath(file, repoRoot);
    
    resources.push({
      resourceType: 'rule',
      resourcePath,
      displayName: metadata.name || basename(file, '.md'),
      description: metadata.description,
      version: metadata.version,
      filePath: file,
      installKind: 'file',
      matchedBy: metadata.name ? 'frontmatter' : 'filename'
    });
  }
  
  return resources;
}

/**
 * Discover hooks (hooks/.../)
 */
async function discoverHooks(
  basePath: string,
  repoRoot: string
): Promise<DiscoveredResource[]> {
  const resources: DiscoveredResource[] = [];
  const hooksDir = join(basePath, 'hooks');
  
  if (!(await exists(hooksDir))) {
    return resources;
  }
  
  // Discover hook files or directories
  for await (const file of walkFiles(hooksDir)) {
    const resourcePath = normalizeResourcePath(file, repoRoot);
    const displayName = basename(file);
    
    resources.push({
      resourceType: 'hook',
      resourcePath,
      displayName,
      filePath: file,
      installKind: 'file'
    });
  }
  
  return resources;
}

/**
 * Discover MCP server configuration files
 */
async function discoverMCP(
  basePath: string,
  repoRoot: string
): Promise<DiscoveredResource[]> {
  const resources: DiscoveredResource[] = [];
  const mcpFiles = ['mcp.jsonc', 'mcp.json'];
  
  for (const filename of mcpFiles) {
    const filePath = join(basePath, filename);
    
    if (await exists(filePath)) {
      const resourcePath = normalizeResourcePath(filePath, repoRoot);
      
      resources.push({
        resourceType: 'mcp',
        resourcePath,
        displayName: 'MCP Server Configuration',
        description: 'Model Context Protocol server configuration',
        filePath,
        installKind: 'file'
      });
      
      // Only return the first found
      break;
    }
  }
  
  return resources;
}

/**
 * Extract metadata from markdown frontmatter
 */
async function extractMarkdownMetadata(
  filePath: string
): Promise<{
  name?: string;
  description?: string;
  version?: string;
}> {
  try {
    const content = await readTextFile(filePath);
    const { frontmatter } = splitFrontmatter(content);
    
    if (!frontmatter) {
      return {};
    }
    
    return {
      name: frontmatter.name,
      description: frontmatter.description,
      version: extractVersionFromFrontmatter(frontmatter)
    };
  } catch (error) {
    logger.debug('Failed to extract metadata', { filePath, error });
    return {};
  }
}

/**
 * Extract version from frontmatter (supports both top-level and nested)
 */
function extractVersionFromFrontmatter(frontmatter: any): string | undefined {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return undefined;
  }
  
  const version = frontmatter.version ?? frontmatter.metadata?.version;
  
  if (typeof version === 'string') {
    const trimmed = version.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  
  return undefined;
}

/**
 * Normalize resource path to be relative to repository root
 */
function normalizeResourcePath(
  absolutePath: string,
  repoRoot: string
): string {
  const rel = relative(repoRoot, absolutePath);
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}
