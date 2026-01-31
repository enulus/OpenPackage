import { Command } from 'commander';
import { join } from 'path';
import type { CommandResult, InstallOptions } from '../types/index.js';
import { withErrorHandling } from '../utils/errors.js';
import { normalizePlatforms } from '../utils/platform-mapper.js';
import { buildInstallContext } from '../core/install/unified/context-builders.js';
import { runUnifiedInstallPipeline } from '../core/install/unified/pipeline.js';
import { determineResolutionMode } from '../utils/resolution-mode.js';
import { DIR_PATTERNS, PACKAGE_PATHS } from '../constants/index.js';
import { normalizePathForProcessing } from '../utils/path-normalization.js';
import type { InstallationContext } from '../core/install/unified/context.js';
import type { LoadedPackage } from '../core/install/sources/base.js';
import { getLoaderForSource } from '../core/install/sources/loader-factory.js';
import { logger } from '../utils/logger.js';

/**
 * Validate that target directory is not inside .openpackage metadata
 */
function assertTargetDirOutsideMetadata(targetDir: string): void {
  const normalized = normalizePathForProcessing(targetDir ?? '.');
  if (!normalized || normalized === '.') {
    return; // default install root
  }

  if (
    normalized === DIR_PATTERNS.OPENPACKAGE ||
    normalized.startsWith(`${DIR_PATTERNS.OPENPACKAGE}/`)
  ) {
    throw new Error(
      `Installation target '${targetDir}' cannot point inside ${DIR_PATTERNS.OPENPACKAGE} ` +
      `(reserved for metadata like ${PACKAGE_PATHS.INDEX_RELATIVE}). ` +
      `Choose a workspace path outside metadata.`
    );
  }
}

/**
 * Validate resolution flags
 */
export function validateResolutionFlags(options: InstallOptions & { local?: boolean; remote?: boolean }): void {
  if (options.remote && options.local) {
    throw new Error('--remote and --local cannot be used together. Choose one resolution mode.');
  }
}

/**
 * Normalize --plugins option value by deduplicating.
 * Since --plugins is now variadic (space-separated), we receive an array directly.
 *
 * @param value - Array of plugin names from variadic option, or undefined
 * @returns Array of unique plugin names, or undefined if empty/not provided
 */
export function normalizePluginsOption(value: string[] | undefined): string[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }

  // Deduplicate
  const plugins = [...new Set(value)];

  return plugins.length > 0 ? plugins : undefined;
}

/**
 * Normalize --skills option value by deduplicating.
 * Since --skills is now variadic (space-separated), we receive an array directly.
 *
 * @param value - Array of skill names from variadic option, or undefined
 * @returns Array of unique skill names, or undefined if empty/not provided
 */
export function normalizeSkillsOption(value: string[] | undefined): string[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }

  // Deduplicate
  const skills = [...new Set(value)];

  return skills.length > 0 ? skills : undefined;
}

/**
 * Normalize --agents option value by deduplicating.
 * Since --agents is now variadic (space-separated), we receive an array directly.
 *
 * @param value - Array of agent names from variadic option, or undefined
 * @returns Array of unique agent names, or undefined if empty/not provided
 */
export function normalizeAgentsOption(value: string[] | undefined): string[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }

  // Deduplicate
  const agents = [...new Set(value)];

  return agents.length > 0 ? agents : undefined;
}

/**
 * Validate skills option usage (placeholder for early validation).
 * Most validation happens after source detection.
 *
 * @param options - Install options
 */
export function validateSkillsOptions(options: InstallOptions): void {
  // Early validation can be added here if needed
  // Most validation deferred until after source type is determined
  // (marketplace vs standalone sources have different requirements)
}

/**
 * Handle skills installation from marketplace source.
 * 
 * @param context - Installation context with loaded marketplace
 * @param options - Install options including --skills and --plugins
 * @param cwd - Current working directory
 * @returns Command result with installation summary
 */
async function handleMarketplaceSkillsInstallation(
  context: InstallationContext,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  // 1. Validate prerequisites
  if (!options.plugins || options.plugins.length === 0) {
    throw new Error(
      'Skills installation from marketplace requires --plugins flag to specify which plugins to search for skills.\n\n' +
      'Example: opkg install <marketplace-url> --plugins essentials --skills git docker'
    );
  }
  
  // 2. Parse marketplace (already done in parent flow)
  if (!context.source.pluginMetadata?.manifestPath) {
    throw new Error('Marketplace manifest not found');
  }
  
  const {
    parseMarketplace,
    validatePluginNames
  } = await import('../core/install/marketplace-handler.js');
  
  const marketplace = await parseMarketplace(context.source.pluginMetadata.manifestPath, {
    repoPath: context.source.contentRoot
  });
  
  // 3. Validate plugins
  const { valid: validPlugins, invalid: invalidPlugins } = validatePluginNames(marketplace, options.plugins);
  
  if (invalidPlugins.length > 0) {
    console.error(`Error: The following plugins were not found in marketplace '${marketplace.name}':`);
    for (const name of invalidPlugins) {
      console.error(`  - ${name}`);
    }
    console.error(`\nAvailable plugins: ${marketplace.plugins.map(p => p.name).join(', ')}`);
    return {
      success: false,
      error: `Plugins not found: ${invalidPlugins.join(', ')}`
    };
  }
  
  if (validPlugins.length === 0) {
    console.log('No valid plugins specified. Installation cancelled.');
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  // 4. Discover skills in selected plugins
  const {
    parseSkillsFromMarketplace,
    promptSkillSelection,
    validateSkillSelections,
    installMarketplaceSkills
  } = await import('../core/install/skills-marketplace-handler.js');
  
  const { Spinner } = await import('../utils/spinner.js');
  const spinner = new Spinner('Discovering skills in selected plugins');
  spinner.start();
  
  const skillsCollection = await parseSkillsFromMarketplace(
    context.source.contentRoot!,
    marketplace,
    validPlugins
  );
  
  spinner.stop();
  
  // Check if any skills were found
  if (skillsCollection.pluginSkills.size === 0) {
    console.error(`Error: Selected plugins do not contain any skills.\n`);
    console.error(`Selected plugins: ${validPlugins.join(', ')}`);
    console.error(`Skills directory must be at root of plugin: plugins/<plugin-name>/skills/`);
    return {
      success: false,
      error: 'No skills found in selected plugins'
    };
  }
  
  // 5. Selection mode (interactive vs non-interactive)
  let selections;
  
  if (options.skills && options.skills.length > 0) {
    // Non-interactive: validate requested skills
    const { valid, invalid } = validateSkillSelections(skillsCollection, options.skills);
    
    if (invalid.length > 0) {
      console.error(`Error: Skills not found: ${invalid.join(', ')}\n`);
      console.error('Available skills in selected plugins:');
      for (const [pluginName, skills] of skillsCollection.pluginSkills.entries()) {
        for (const skill of skills) {
          const desc = skill.frontmatter.description ? ` - ${skill.frontmatter.description}` : '';
          console.error(`  [${pluginName}] ${skill.name}${desc}`);
        }
      }
      return {
        success: false,
        error: `Skills not found: ${invalid.join(', ')}`
      };
    }
    
    selections = valid;
    const totalSkills = selections.selections.reduce((sum, s) => sum + s.skills.length, 0);
    console.log(`✓ Marketplace: ${marketplace.name}`);
    console.log(`Installing ${totalSkills} skill${totalSkills === 1 ? '' : 's'}...`);
  } else {
    // Interactive: prompt user
    selections = await promptSkillSelection(skillsCollection);
    
    if (selections.selections.length === 0) {
      console.log('No skills selected. Installation cancelled.');
      return { success: true, data: { installed: 0, skipped: 0 } };
    }
  }
  
  // 6. Install selected skills
  if (context.source.type !== 'git' || !context.source.gitUrl) {
    throw new Error('Marketplace must be from a git source');
  }
  
  const commitSha = (context.source as any)._commitSha || '';
  if (!commitSha) {
    throw new Error('Marketplace commit SHA not available. Please report this issue.');
  }
  
  return await installMarketplaceSkills(
    context.source.contentRoot!,
    selections,
    context.source.gitUrl,
    context.source.gitRef,
    commitSha,
    options,
    cwd
  );
}

/**
 * Handle skills installation from standalone plugin, package, or repository.
 * 
 * @param context - Installation context
 * @param loaded - Loaded package information
 * @param options - Install options including --skills
 * @param cwd - Current working directory
 * @returns Command result with installation summary
 */
async function handleSkillsCollectionInstallation(
  context: InstallationContext,
  loaded: LoadedPackage,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const { detectSkillsInDirectory, validateSkillExists } = await import('../core/install/skills-detector.js');
  
  // 1. Detect skills in collection
  const detection = await detectSkillsInDirectory(loaded.contentRoot);
  
  if (!detection.hasSkills) {
    throw new Error('No skills found in source');
  }
  
  // 2. Validate requested skills exist
  const { valid: validSkills, invalid: invalidSkills } = validateSkillExists(
    detection.discoveredSkills,
    options.skills!
  );
  
  if (invalidSkills.length > 0) {
    console.error(`Error: Skills not found: ${invalidSkills.join(', ')}\n`);
    console.error('Available skills:');
    for (const skill of detection.discoveredSkills) {
      const desc = skill.frontmatter.description ? ` - ${skill.frontmatter.description}` : '';
      console.error(`  ${skill.name}${desc}`);
    }
    return {
      success: false,
      error: `Skills not found: ${invalidSkills.join(', ')}`
    };
  }
  
  if (validSkills.length === 0) {
    console.log('No valid skills specified. Installation cancelled.');
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  // 3. Install each skill as a separate package
  console.log(`Installing ${validSkills.length} skill${validSkills.length === 1 ? '' : 's'}...`);
  
  const { buildPathInstallContext } = await import('../core/install/unified/context-builders.js');
  
  const results: Array<{
    name: string;
    success: boolean;
    error?: string;
  }> = [];
  
  for (const skill of validSkills) {
    try {
      // Create install context pointing to PARENT directory with content filter
      const skillContext = await buildPathInstallContext(
        cwd,
        loaded.contentRoot,
        {
          ...options,
          sourceType: 'directory' as const,
          contentFilter: skill.skillPath,
          contentType: 'skills' as const,
          skillMetadata: {
            name: skill.name,
            skillPath: skill.skillPath
          }
        }
      );
      
      // Set git source override for manifest tracking
      if (context.source.type === 'git' && context.source.gitUrl) {
        skillContext.source.gitSourceOverride = {
          gitUrl: context.source.gitUrl,
          gitRef: context.source.gitRef,
          gitPath: skill.skillPath
        };
      }
      
      // Store skill metadata in context for loader
      skillContext.source.pluginMetadata = {
        isPlugin: false,
        isSkill: true,
        skillMetadata: {
          skill
        }
      };
      
      // Install with skill filter
      const result = await runUnifiedInstallPipeline(skillContext);
      
      if (result.success) {
        console.log(`✓ ${skill.name}`);
        results.push({ name: skill.name, success: true });
      } else {
        console.error(`❌ ${skill.name}: ${result.error}`);
        results.push({ name: skill.name, success: false, error: result.error });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${skill.name}: ${errorMsg}`);
      results.push({ name: skill.name, success: false, error: errorMsg });
    }
  }
  
  // Display summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log('');
  if (successful.length > 0) {
    console.log(`✓ Successfully installed: ${successful.length} skill${successful.length === 1 ? '' : 's'}`);
  }
  
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length} skill${failed.length === 1 ? '' : 's'}`);
    for (const result of failed) {
      console.log(`  ${result.name}: ${result.error}`);
    }
  }
  
  // Return result
  const anySuccess = results.some(r => r.success);
  return {
    success: anySuccess,
    data: { installed: successful.length, failed: failed.length },
    error: !anySuccess ? 'Failed to install any skills' : undefined
  };
}

/**
 * Handle agents installation from marketplace source.
 * 
 * @param context - Installation context with loaded marketplace
 * @param loaded - Loaded package information  
 * @param options - Install options including --agents and --plugins
 * @param cwd - Current working directory
 * @returns Command result with installation summary
 */
async function handleMarketplaceAgentsInstallation(
  context: InstallationContext,
  loaded: LoadedPackage,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  // 1. Validate prerequisites
  if (!options.plugins || options.plugins.length === 0) {
    throw new Error(
      'Agents installation from marketplace requires --plugins flag to specify which plugins to search for agents.\n\n' +
      'Example: opkg install <marketplace-url> --plugins ui-design --agents accessibility-expert ui-designer'
    );
  }
  
  // 2. Parse marketplace (already done in parent flow)
  if (!context.source.pluginMetadata?.manifestPath) {
    throw new Error('Marketplace manifest not found');
  }
  
  const {
    parseMarketplace,
    validatePluginNames
  } = await import('../core/install/marketplace-handler.js');
  
  const marketplace = await parseMarketplace(context.source.pluginMetadata.manifestPath, {
    repoPath: context.source.contentRoot
  });
  
  // 3. Validate plugins
  const { valid: validPlugins, invalid: invalidPlugins } = validatePluginNames(marketplace, options.plugins);
  
  if (invalidPlugins.length > 0) {
    console.error(`Error: The following plugins were not found in marketplace '${marketplace.name}':`);
    for (const name of invalidPlugins) {
      console.error(`  - ${name}`);
    }
    console.error(`\nAvailable plugins: ${marketplace.plugins.map(p => p.name).join(', ')}`);
    return {
      success: false,
      error: `Plugins not found: ${invalidPlugins.join(', ')}`
    };
  }
  
  if (validPlugins.length === 0) {
    console.log('No valid plugins specified. Installation cancelled.');
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  // 4. Discover agents in selected plugins
  const { detectContentInDirectory, validateContentExists } = await import('../core/install/content-detector.js');
  const { getContentTypeDefinition } = await import('../core/install/content-type-registry.js');
  const { Spinner } = await import('../utils/spinner.js');
  const { join } = await import('path');
  
  const definition = getContentTypeDefinition('agents');
  const spinner = new Spinner(`Discovering ${definition.pluralName} in selected plugins`);
  spinner.start();
  
  // Collect all agents from selected plugins
  const pluginAgents = new Map<string, any[]>();
  
  for (const pluginName of validPlugins) {
    const plugin = marketplace.plugins.find(p => p.name === pluginName);
    if (!plugin) continue;
    
    const pluginDir = join(context.source.contentRoot!, 'plugins', pluginName);
    
    try {
      const detection = await detectContentInDirectory(pluginDir, 'agents');
      if (detection.hasContent) {
        pluginAgents.set(pluginName, detection.discoveredItems);
      }
    } catch (error) {
      console.warn(`Warning: Failed to detect agents in plugin '${pluginName}'`);
    }
  }
  
  spinner.stop();
  
  // Check if any agents were found
  if (pluginAgents.size === 0) {
    console.error(`Error: Selected plugins do not contain any ${definition.pluralName}.\n`);
    console.error(`Selected plugins: ${validPlugins.join(', ')}`);
    console.error(`${definition.pluralName} directory must be at root of plugin: plugins/<plugin-name>/${definition.directoryPattern}`);
    return {
      success: false,
      error: `No ${definition.pluralName} found in selected plugins`
    };
  }
  
  // 5. Validate requested agents exist
  const allAgents = Array.from(pluginAgents.values()).flat();
  const { valid: validAgents, invalid: invalidAgents } = validateContentExists(
    allAgents,
    options.agents!
  );
  
  if (invalidAgents.length > 0) {
    console.error(`Error: ${definition.pluralName} not found: ${invalidAgents.join(', ')}\n`);
    console.error(`Available ${definition.pluralName} in selected plugins:`);
    for (const [pluginName, agents] of pluginAgents.entries()) {
      for (const agent of agents) {
        const desc = agent.frontmatter.description ? ` - ${agent.frontmatter.description}` : '';
        console.error(`  [${pluginName}] ${agent.name}${desc}`);
      }
    }
    return {
      success: false,
      error: `${definition.pluralName} not found: ${invalidAgents.join(', ')}`
    };
  }
  
  if (validAgents.length === 0) {
    console.log(`No valid ${definition.pluralName} specified. Installation cancelled.`);
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  // 6. Install selected agents
  console.log(`✓ Marketplace: ${marketplace.name}`);
  console.log(`Installing ${validAgents.length} ${validAgents.length === 1 ? definition.singularName : definition.pluralName}...`);
  
  const { buildPathInstallContext } = await import('../core/install/unified/context-builders.js');
  const results: Array<{ name: string; success: boolean; error?: string }> = [];
  
  if (context.source.type !== 'git' || !context.source.gitUrl) {
    throw new Error('Marketplace must be from a git source');
  }
  
  const commitSha = (context.source as any)._commitSha || '';
  if (!commitSha) {
    throw new Error('Marketplace commit SHA not available. Please report this issue.');
  }
  
  for (const agent of validAgents) {
    // Find which plugin this agent belongs to
    let pluginName = '';
    let pluginEntry: any;
    for (const [pName, agents] of pluginAgents.entries()) {
      if (agents.some(a => a.name === agent.name)) {
        pluginName = pName;
        pluginEntry = marketplace.plugins.find(p => p.name === pName);
        break;
      }
    }
    
    if (!pluginEntry) {
      console.error(`❌ ${agent.name}: Plugin entry not found`);
      results.push({ name: agent.name, success: false, error: 'Plugin entry not found' });
      continue;
    }
    
    try {
      // Use the normalized plugin source to get the plugin subdirectory
      const { normalizePluginSource, isRelativePathSource } = await import('../core/install/plugin-sources.js');
      const normalizedSource = normalizePluginSource(pluginEntry.source, pluginEntry.name);
      
      if (!isRelativePathSource(normalizedSource)) {
        throw new Error('Git source plugins not yet supported for agents installation');
      }
      
      const pluginSubdir = normalizedSource.relativePath!;
      const pluginDir = join(context.source.contentRoot!, pluginSubdir);
      
      // Build complete agent path (plugin path + agent path)
      const completeAgentPath = join(pluginSubdir, agent.itemPath).replace(/\\/g, '/');
      
      // Build naming context for the agent (similar to skills)
      const { SkillContextBuilder } = await import('../core/install/naming-context-builder.js');
      const namingContext = new SkillContextBuilder()
        .withGit(context.source.gitUrl, context.source.gitRef, completeAgentPath)
        .withPhysical(pluginDir)
        .withSkillInfo(agent.name, pluginSubdir, agent.itemPath)
        .withMarketplace('', commitSha, pluginEntry.name)
        .build();
      
      // Create install context pointing to plugin directory with agent filter
      const agentContext = await buildPathInstallContext(
        cwd,
        pluginDir,
        {
          ...options,
          sourceType: 'directory' as const,
          contentFilter: agent.itemPath,
          contentType: 'agents' as const,
          skillMetadata: {
            name: agent.name,
            skillPath: agent.itemPath
          }
        }
      );
      
      // Set git source override for manifest tracking (using complete path)
      agentContext.source.gitSourceOverride = {
        gitUrl: context.source.gitUrl,
        gitRef: context.source.gitRef,
        gitPath: completeAgentPath
      };
      
      // Store agent metadata AND naming context
      agentContext.source.pluginMetadata = {
        isPlugin: false,
        isSingleContent: true,
        contentType: 'agents',
        contentMetadata: {
          item: agent,
          pluginName: pluginEntry.name
        }
      };
      
      // Store naming context for downstream use
      (agentContext.source as any)._namingContext = namingContext;
      
      // Install with content filter
      const result = await runUnifiedInstallPipeline(agentContext);
      
      if (result.success) {
        console.log(`✓ ${agent.name} (from ${pluginName})`);
        results.push({ name: agent.name, success: true });
      } else {
        console.error(`❌ ${agent.name}: ${result.error}`);
        results.push({ name: agent.name, success: false, error: result.error });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${agent.name}: ${errorMsg}`);
      results.push({ name: agent.name, success: false, error: errorMsg });
    }
  }
  
  // Display summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log('');
  if (successful.length > 0) {
    console.log(`✓ Successfully installed: ${successful.length} ${successful.length === 1 ? definition.singularName : definition.pluralName}`);
  }
  
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length} ${failed.length === 1 ? definition.singularName : definition.pluralName}`);
    for (const result of failed) {
      console.log(`  ${result.name}: ${result.error}`);
    }
  }
  
  const anySuccess = results.some(r => r.success);
  return {
    success: anySuccess,
    data: { installed: successful.length, failed: failed.length },
    error: !anySuccess ? `Failed to install any ${definition.pluralName}` : undefined
  };
}

/**
 * Handle content collection installation (skills, agents, etc.).
 * 
 * @param context - Installation context
 * @param loaded - Loaded package information
 * @param options - Install options including --skills or --agents
 * @param cwd - Current working directory
 * @param contentType - Type of content to install
 * @returns Command result with installation summary
 */
async function handleContentCollectionInstallation(
  context: InstallationContext,
  loaded: LoadedPackage,
  options: InstallOptions,
  cwd: string,
  contentType: 'skills' | 'agents'
): Promise<CommandResult> {
  const { detectContentInDirectory, validateContentExists } = await import('../core/install/content-detector.js');
  const { getContentTypeDefinition } = await import('../core/install/content-type-registry.js');
  
  const definition = getContentTypeDefinition(contentType);
  const requestedNames = contentType === 'skills' ? options.skills : options.agents;
  
  if (!requestedNames || requestedNames.length === 0) {
    throw new Error(`No ${definition.pluralName} specified`);
  }
  
  // 1. Detect content in collection
  const detection = await detectContentInDirectory(loaded.contentRoot, contentType);
  
  if (!detection.hasContent) {
    throw new Error(`No ${definition.pluralName} found in source`);
  }
  
  // 2. Validate requested content items exist
  const { valid: validItems, invalid: invalidItems } = validateContentExists(
    detection.discoveredItems,
    requestedNames
  );
  
  if (invalidItems.length > 0) {
    console.error(`Error: ${definition.pluralName} not found: ${invalidItems.join(', ')}\n`);
    console.error(`Available ${definition.pluralName}:`);
    for (const item of detection.discoveredItems) {
      const desc = item.frontmatter.description ? ` - ${item.frontmatter.description}` : '';
      console.error(`  ${item.name}${desc}`);
    }
    return {
      success: false,
      error: `${definition.pluralName} not found: ${invalidItems.join(', ')}`
    };
  }
  
  if (validItems.length === 0) {
    console.log(`No valid ${definition.pluralName} specified. Installation cancelled.`);
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  // 3. Install each content item as a separate package
  console.log(`Installing ${validItems.length} ${validItems.length === 1 ? definition.singularName : definition.pluralName}...`);
  
  const { buildPathInstallContext } = await import('../core/install/unified/context-builders.js');
  
  const results: Array<{
    name: string;
    success: boolean;
    error?: string;
  }> = [];
  
  for (const item of validItems) {
    try {
      // Create install context pointing to PARENT directory with content filter
      const itemContext = await buildPathInstallContext(
        cwd,
        loaded.contentRoot,
        {
          ...options,
          sourceType: 'directory' as const,
          contentFilter: item.itemPath,
          contentType: contentType,
          skillMetadata: {
            name: item.name,
            skillPath: item.itemPath
          }
        }
      );
      
      // Set git source override for manifest tracking
      if (context.source.type === 'git' && context.source.gitUrl) {
        itemContext.source.gitSourceOverride = {
          gitUrl: context.source.gitUrl,
          gitRef: context.source.gitRef,
          gitPath: item.itemPath
        };
      }
      
      // Store content metadata in context for loader
      itemContext.source.pluginMetadata = {
        isPlugin: false,
        isSingleContent: true,
        contentType: contentType,
        contentMetadata: {
          item
        }
      };
      
      // Install with content filter
      const result = await runUnifiedInstallPipeline(itemContext);
      
      if (result.success) {
        console.log(`✓ ${item.name}`);
        results.push({ name: item.name, success: true });
      } else {
        console.error(`❌ ${item.name}: ${result.error}`);
        results.push({ name: item.name, success: false, error: result.error });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${item.name}: ${errorMsg}`);
      results.push({ name: item.name, success: false, error: errorMsg });
    }
  }
  
  // Display summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log('');
  if (successful.length > 0) {
    console.log(`✓ Successfully installed: ${successful.length} ${successful.length === 1 ? definition.singularName : definition.pluralName}`);
  }
  
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length} ${failed.length === 1 ? definition.singularName : definition.pluralName}`);
    for (const result of failed) {
      console.log(`  ${result.name}: ${result.error}`);
    }
  }
  
  // Return result
  const anySuccess = results.some(r => r.success);
  return {
    success: anySuccess,
    data: { installed: successful.length, failed: failed.length },
    error: !anySuccess ? `Failed to install any ${definition.pluralName}` : undefined
  };
}

/**
 * Main install command handler
 */
async function installCommand(
  packageInput: string | undefined,
  options: InstallOptions
): Promise<CommandResult> {
  const cwd = process.cwd();
  const targetDir = '.';
  
  // Validate inputs
  assertTargetDirOutsideMetadata(targetDir);
  validateResolutionFlags(options);
  
  // Set resolution mode
  options.resolutionMode = determineResolutionMode(options);
  
  // Build context(s)
  const contexts = await buildInstallContext(cwd, packageInput, options);
  
  // Handle bulk install (multiple contexts)
  if (Array.isArray(contexts)) {
    return await runBulkInstall(contexts);
  }
  
  // For git sources, we need to load the package first to detect if it's a marketplace
  // Marketplaces are detected during loadPackagePhase, so we need to check after loading
  if (contexts.source.type === 'git') {
    // Load package to detect marketplace
    const loader = getLoaderForSource(contexts.source);
    const loaded = await loader.load(contexts.source, options, cwd);
    
    // Update context with loaded info
    contexts.source.packageName = loaded.packageName;
    contexts.source.version = loaded.version;
    contexts.source.contentRoot = loaded.contentRoot;
    contexts.source.pluginMetadata = loaded.pluginMetadata;
    
    // Store commitSha for marketplace handling
    if (loaded.sourceMetadata?.commitSha) {
      (contexts.source as any)._commitSha = loaded.sourceMetadata.commitSha;
    }
    
    // Check if marketplace - handle at command level
    if (contexts.source.pluginMetadata?.pluginType === 'marketplace') {
      // Check if agents installation requested
      if (options.agents && options.agents.length > 0) {
        return await handleMarketplaceAgentsInstallation(contexts, loaded, options, cwd);
      }
      // Check if skills installation requested
      if (options.skills && options.skills.length > 0) {
        return await handleMarketplaceSkillsInstallation(contexts, options, cwd);
      }
      return await handleMarketplaceInstallation(contexts, options, cwd);
    }

    // Check if content collection (non-marketplace): skills or agents
    const isContentCollection = contexts.source.pluginMetadata?.isContentCollection || 
                                contexts.source.pluginMetadata?.isSkillsCollection; // legacy
    const contentType = loaded.contentType || contexts.source.pluginMetadata?.contentType;
    
    if (isContentCollection && contentType) {
      const contentOption = contentType === 'skills' ? options.skills : options.agents;
      const { getContentTypeDefinition } = await import('../core/install/content-type-registry.js');
      const definition = getContentTypeDefinition(contentType);
      
      if (!contentOption || contentOption.length === 0) {
        // No content specified - error with available items
        const detection = loaded.sourceMetadata?.contentDetection || 
                         loaded.sourceMetadata?.skillsDetection; // legacy
        const hasContent = detection && ('hasContent' in detection ? detection.hasContent : (detection as any).hasSkills);
        if (hasContent) {
          const items = 'discoveredItems' in detection ? detection.discoveredItems : (detection as any).discoveredSkills;

          // If user explicitly provided a git subdirectory path that resolves to a collection,
          // default to installing ALL items in that collection.
          // This avoids forcing flags for "install this directory" workflows.
          const shouldInstallAllByDefault = contexts.source.type === 'git' && !!contexts.source.gitPath;
          if (shouldInstallAllByDefault) {
            const allNames = items.map((i: any) => i.name).filter((n: any) => typeof n === 'string' && n.length > 0);

            const nextOptions: InstallOptions = {
              ...options,
              skills: contentType === 'skills' ? allNames : options.skills,
              agents: contentType === 'agents' ? allNames : options.agents
            };
            return await handleContentCollectionInstallation(contexts, loaded, nextOptions, cwd, contentType);
          }

          console.error(`Error: This is a ${definition.pluralName} collection. Use --${definition.pluralName} flag to specify which ${definition.pluralName} to install.\n`);
          console.error(`Available ${definition.pluralName}:`);
          for (const item of items) {
            const desc = item.frontmatter?.description ? ` - ${item.frontmatter.description}` : '';
            console.error(`  ${item.name}${desc}`);
          }
        }
        return {
          success: false,
          error: `${definition.pluralName} collection requires --${definition.pluralName} flag to specify which ${definition.pluralName} to install`
        };
      }
      return await handleContentCollectionInstallation(contexts, loaded, options, cwd, contentType);
    }

    // Not a marketplace - warn if --plugins was specified
    if (options.plugins && options.plugins.length > 0) {
      console.log('Warning: --plugins flag is only used with marketplace sources. Ignoring.');
    }
    
    // Warn if --skills specified but not a collection
    if (options.skills && options.skills.length > 0 && !loaded.sourceMetadata?.skillsDetection?.hasSkills && !loaded.sourceMetadata?.contentDetection?.hasContent) {
      console.log('Warning: --skills flag specified but source is not a skills collection. Installing entire package.');
    }
    
    // Warn if --agents specified but not a collection
    if (options.agents && options.agents.length > 0 && !loaded.sourceMetadata?.contentDetection?.hasContent) {
      console.log('Warning: --agents flag specified but source is not an agents collection. Installing entire package.');
    }

    // Regular package install (including single skills - they're now regular packages!)
    // Create resolved package for the loaded package
    contexts.resolvedPackages = [{
      name: loaded.packageName,
      version: loaded.version,
      pkg: { metadata: loaded.metadata, files: [], _format: undefined },
      isRoot: true,
      source: 'git',
      contentRoot: loaded.contentRoot
    }];
  }
  
  // Single package install
  return await runUnifiedInstallPipeline(contexts);
}

/**
 * Handle marketplace installation with plugin selection
 */
async function handleMarketplaceInstallation(
  context: InstallationContext,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const {
    parseMarketplace,
    promptPluginSelection,
    installMarketplacePlugins,
    validatePluginNames
  } = await import('../core/install/marketplace-handler.js');
  const { Spinner } = await import('../utils/spinner.js');

  // Load the marketplace package (already loaded, use context data)
  if (!context.source.pluginMetadata?.manifestPath) {
    throw new Error('Marketplace manifest not found');
  }

  const spinner = new Spinner('Loading marketplace');
  spinner.start();

  // Parse marketplace manifest
  const marketplace = await parseMarketplace(context.source.pluginMetadata.manifestPath, {
    repoPath: context.source.contentRoot
  });

  spinner.stop();

  let selectedPlugins: string[];

  // Check if --plugins flag was provided
  if (options.plugins && options.plugins.length > 0) {
    // Non-interactive mode: validate and use provided plugin names
    const { valid, invalid } = validatePluginNames(marketplace, options.plugins);

    if (invalid.length > 0) {
      console.error(`Error: The following plugins were not found in marketplace '${marketplace.name}':`);
      for (const name of invalid) {
        console.error(`  - ${name}`);
      }
      console.error(`\nAvailable plugins: ${marketplace.plugins.map(p => p.name).join(', ')}`);
      return {
        success: false,
        error: `Plugins not found: ${invalid.join(', ')}`
      };
    }

    if (valid.length === 0) {
      console.log('No valid plugins specified. Installation cancelled.');
      return { success: true, data: { installed: 0, skipped: 0 } };
    }

    selectedPlugins = valid;
    console.log(`✓ Marketplace: ${marketplace.name}`);
    console.log(`Installing ${selectedPlugins.length} plugin${selectedPlugins.length === 1 ? '' : 's'}: ${selectedPlugins.join(', ')}`);
  } else {
    // Interactive mode: prompt user to select plugins
    selectedPlugins = await promptPluginSelection(marketplace);

    if (selectedPlugins.length === 0) {
      console.log('No plugins selected. Installation cancelled.');
      return { success: true, data: { installed: 0, skipped: 0 } };
    }
  }

  // Install selected plugins using marketplace handler
  // At this point we know it's a git source with a gitUrl
  if (context.source.type !== 'git' || !context.source.gitUrl) {
    throw new Error('Marketplace must be from a git source');
  }

  // Get commitSha from source metadata
  const commitSha = (context.source as any)._commitSha || '';
  if (!commitSha) {
    logger.error('Marketplace commit SHA not available', {
      source: context.source,
      hasSourceMetadata: !!(context.source as any).sourceMetadata,
      _commitSha: (context.source as any)._commitSha
    });
    throw new Error('Marketplace commit SHA not available. Please report this issue.');
  }

  return await installMarketplacePlugins(
    context.source.contentRoot!,
    marketplace,
    selectedPlugins,
    context.source.gitUrl,
    context.source.gitRef,
    commitSha,
    options,
    cwd
  );
}

/**
 * Run bulk installation for multiple packages
 */
async function runBulkInstall(contexts: InstallationContext[]): Promise<CommandResult> {
  if (contexts.length === 0) {
    console.log('⚠️  No packages found in openpackage.yml');
    console.log('\n💡 Tips:');
    console.log('  • Add packages to the "dependencies" array in openpackage.yml');
    console.log('  • Add development packages to the "dev-dependencies" array');
    console.log('  • Use "opkg install <package-name>" to install a specific package');
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  console.log(`✓ Installing ${contexts.length} package${contexts.length === 1 ? '' : 's'} from openpackage.yml`);
  
  let totalInstalled = 0;
  let totalSkipped = 0;
  const results: Array<{ name: string; success: boolean; error?: string }> = [];
  
  for (const ctx of contexts) {
    try {
      const result = await runUnifiedInstallPipeline(ctx);
      
      if (result.success) {
        totalInstalled++;
        results.push({ name: ctx.source.packageName, success: true });
      } else {
        totalSkipped++;
        results.push({ name: ctx.source.packageName, success: false, error: result.error });
        console.log(`❌ ${ctx.source.packageName}: ${result.error}`);
      }
    } catch (error) {
      totalSkipped++;
      results.push({ name: ctx.source.packageName, success: false, error: String(error) });
      console.log(`❌ ${ctx.source.packageName}: ${error}`);
    }
  }
  
  // Display summary
  console.log(`✓ Installation complete: ${totalInstalled} installed${totalSkipped > 0 ? `, ${totalSkipped} failed` : ''}`);
  
  const allSuccessful = totalSkipped === 0;
  return {
    success: allSuccessful,
    data: { installed: totalInstalled, skipped: totalSkipped, results },
    error: allSuccessful ? undefined : `${totalSkipped} packages failed to install`
  };
}

/**
 * Setup install command
 */
export function setupInstallCommand(program: Command): void {
  program
    .command('install')
    .alias('i')
    .description('Install packages to workspace')
    .argument(
      '[package-name]',
      'name of the package to install (optional - installs workspace-level files and all packages from openpackage.yml if not specified). ' +
      'Supports package@version syntax.'
    )
    .option('--dry-run', 'preview changes without applying them')
    .option('--force', 'overwrite existing files')
    .option('--conflicts <strategy>', 'conflict handling strategy: keep-both, overwrite, skip, or ask')
    .option('--dev', 'add package to dev-dependencies instead of dependencies')
    .option('--platforms <platforms...>', 'prepare specific platforms (e.g., cursor claudecode opencode)')
    .option('--remote', 'pull and install from remote registry, ignoring local versions')
    .option('--local', 'resolve and install using only local registry versions, skipping remote metadata and pulls')
    .option('--profile <profile>', 'profile to use for authentication')
    .option('--api-key <key>', 'API key for authentication (overrides profile)')
    .option('--plugins <names...>', 'install specific plugins from marketplace (bypasses interactive selection)')
    .option('--skills <names...>', 'install specific skills from skills collection (for marketplaces: must be paired with --plugins; for standalone: filters to install only specified skills)')
    .option('--agents <names...>', 'install specific agents from agents collection (filters to install only specified agents)')
    .action(withErrorHandling(async (packageName: string | undefined, options: InstallOptions) => {
      // Normalize platforms
      options.platforms = normalizePlatforms(options.platforms);

      // Normalize plugins
      if (options.plugins) {
        options.plugins = normalizePluginsOption(options.plugins as any);
      }
      
      // Normalize skills
      if (options.skills) {
        options.skills = normalizeSkillsOption(options.skills as any);
      }
      
      // Normalize agents
      if (options.agents) {
        options.agents = normalizeAgentsOption(options.agents as any);
      }
      
      // Validate skills options
      validateSkillsOptions(options);

      // Normalize conflict strategy
      const commandOptions = options as InstallOptions & { conflicts?: string };
      const rawConflictStrategy = commandOptions.conflicts ?? options.conflictStrategy;
      if (rawConflictStrategy) {
        const normalizedStrategy = (rawConflictStrategy as string).toLowerCase();
        const allowedStrategies: InstallOptions['conflictStrategy'][] = [
          'keep-both', 'overwrite', 'skip', 'ask'
        ];
        if (!allowedStrategies.includes(normalizedStrategy as InstallOptions['conflictStrategy'])) {
          throw new Error(
            `Invalid --conflicts value '${rawConflictStrategy}'. ` +
            `Use one of: keep-both, overwrite, skip, ask.`
          );
        }
        options.conflictStrategy = normalizedStrategy as InstallOptions['conflictStrategy'];
      }

      // Execute install
      const result = await installCommand(packageName, options);
      
      if (!result.success) {
        if (result.error === 'Package not found') {
          return; // Already displayed message
        }
        throw new Error(result.error || 'Installation operation failed');
      }
    }));
}
