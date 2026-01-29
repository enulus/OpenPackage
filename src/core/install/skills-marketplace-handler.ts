/**
 * Skills Marketplace Handler Module
 * 
 * Handles marketplace-specific skills operations, including discovery across
 * multiple plugins, user selection, and coordinated installation.
 */

import { join } from 'path';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { UserCancellationError } from '../../utils/errors.js';
import { safePrompts } from '../../utils/prompts.js';
import { Spinner } from '../../utils/spinner.js';
import type { CommandResult, InstallOptions } from '../../types/index.js';
import {
  detectSkillsInDirectory,
  findSkillByName,
  type DiscoveredSkill
} from './skills-detector.js';
import type { MarketplaceManifest, MarketplacePluginEntry } from './marketplace-handler.js';
import {
  normalizePluginSource,
  isRelativePathSource,
  type NormalizedPluginSource
} from './plugin-sources.js';
import { SkillContextBuilder } from './naming-context-builder.js';
import { PackageNameService } from './package-name-service.js';

/**
 * Organizes discovered skills by their parent plugin.
 */
export interface SkillsCollectionMap {
  /**
   * Reference to parsed marketplace manifest
   */
  marketplace: MarketplaceManifest;
  
  /**
   * Map from plugin name to array of discovered skills
   */
  pluginSkills: Map<string, DiscoveredSkill[]>;
}

/**
 * Represents user's skill selections organized by plugin.
 */
export interface SkillSelectionResult {
  /**
   * Array of selections, each containing plugin and its selected skills
   */
  selections: Array<{
    pluginName: string;
    pluginEntry: MarketplacePluginEntry;
    skills: DiscoveredSkill[];
  }>;
}

/**
 * Discover all skills within selected marketplace plugins.
 * 
 * @param marketplaceDir - Absolute path to cloned marketplace repository root
 * @param marketplace - Parsed marketplace manifest
 * @param selectedPlugins - Names of plugins to search for skills
 * @returns Skills collection map with discovered skills per plugin
 */
export async function parseSkillsFromMarketplace(
  marketplaceDir: string,
  marketplace: MarketplaceManifest,
  selectedPlugins: string[]
): Promise<SkillsCollectionMap> {
  logger.debug('Parsing skills from marketplace plugins', {
    marketplace: marketplace.name,
    selectedPlugins
  });
  
  const pluginSkills = new Map<string, DiscoveredSkill[]>();
  
  for (const pluginName of selectedPlugins) {
    // Find plugin entry in marketplace
    const pluginEntry = marketplace.plugins.find(p => p.name === pluginName);
    if (!pluginEntry) {
      logger.warn('Plugin not found in marketplace', { pluginName });
      continue;
    }
    
    // Normalize plugin source
    let normalizedSource: NormalizedPluginSource;
    try {
      normalizedSource = normalizePluginSource(pluginEntry.source, pluginName);
    } catch (error) {
      logger.error('Failed to normalize plugin source', { pluginName, error });
      continue;
    }
    
    // Only process relative path sources (git sources handled during installation)
    if (!isRelativePathSource(normalizedSource)) {
      logger.debug('Skipping git source plugin for skills discovery', { pluginName });
      continue;
    }
    
    // Determine plugin directory path
    const pluginSubdir = normalizedSource.relativePath!;
    const pluginDir = join(marketplaceDir, pluginSubdir);
    
    // Verify plugin directory exists
    if (!(await exists(pluginDir))) {
      logger.warn('Plugin directory not found', { pluginName, pluginDir });
      continue;
    }
    
    // Detect skills in plugin directory
    try {
      const detection = await detectSkillsInDirectory(pluginDir);
      
      if (detection.hasSkills) {
        pluginSkills.set(pluginName, detection.discoveredSkills);
        logger.info('Discovered skills in plugin', {
          pluginName,
          skillCount: detection.discoveredSkills.length
        });
      } else {
        logger.debug('No skills found in plugin', { pluginName });
      }
    } catch (error) {
      logger.error('Skills detection failed for plugin', { pluginName, error });
      continue;
    }
  }
  
  logger.info('Skills parsing complete', {
    marketplace: marketplace.name,
    pluginsWithSkills: pluginSkills.size,
    totalSkills: Array.from(pluginSkills.values()).reduce((sum, skills) => sum + skills.length, 0)
  });
  
  return {
    marketplace,
    pluginSkills
  };
}

/**
 * Interactive multi-select prompt for skill selection with plugin grouping.
 * 
 * @param skillsCollection - Skills collection map from parseSkillsFromMarketplace
 * @returns Skill selection result (empty if user cancelled)
 */
export async function promptSkillSelection(
  skillsCollection: SkillsCollectionMap
): Promise<SkillSelectionResult> {
  const { marketplace, pluginSkills } = skillsCollection;
  
  // Display marketplace header
  console.log(`✓ Marketplace: ${marketplace.name}`);
  if (marketplace.description) {
    console.log(`  ${marketplace.description}`);
  }
  console.log('');
  console.log('Available skills:');
  console.log('');
  
  // Build choices array with plugin grouping
  const choices: Array<{
    title: string;
    value: string;
    description?: string;
    disabled?: boolean;
  }> = [];
  
  for (const [pluginName, skills] of pluginSkills.entries()) {
    // Add plugin name as separator
    choices.push({
      title: `[${pluginName}]`,
      value: `__separator_${pluginName}`,
      disabled: true
    });
    
    // Add skills from this plugin
    for (const skill of skills) {
      const uniqueKey = `${pluginName}:${skill.name}`;
      choices.push({
        title: `  ${skill.name}`,
        value: uniqueKey,
        description: skill.frontmatter.description || ''
      });
    }
    
    // Add empty line between plugin groups
    choices.push({
      title: '',
      value: `__empty_${pluginName}`,
      disabled: true
    });
  }
  
  // Remove trailing empty separator if present
  if (choices.length > 0 && choices[choices.length - 1].disabled) {
    choices.pop();
  }
  
  try {
    const response = await safePrompts({
      type: 'multiselect',
      name: 'skills',
      message: 'Select skills to install (space to select, enter to confirm):',
      choices,
      min: 0,
      hint: '- Use arrow keys to navigate, space to select/deselect, enter to confirm'
    });
    
    if (!response.skills || response.skills.length === 0) {
      logger.info('User cancelled skill selection or selected nothing');
      return { selections: [] };
    }
    
    // Parse selected keys back to plugin/skill associations
    const selectedKeys = response.skills as string[];
    const selectionMap = new Map<string, DiscoveredSkill[]>();
    
    for (const key of selectedKeys) {
      // Skip separator/empty entries
      if (key.startsWith('__')) {
        continue;
      }
      
      const [pluginName, skillName] = key.split(':', 2);
      const skills = pluginSkills.get(pluginName);
      if (!skills) {
        continue;
      }
      
      const skill = findSkillByName(skills, skillName);
      if (!skill) {
        continue;
      }
      
      if (!selectionMap.has(pluginName)) {
        selectionMap.set(pluginName, []);
      }
      selectionMap.get(pluginName)!.push(skill);
    }
    
    // Build result structure
    const selections = Array.from(selectionMap.entries()).map(([pluginName, skills]) => {
      const pluginEntry = marketplace.plugins.find(p => p.name === pluginName)!;
      return {
        pluginName,
        pluginEntry,
        skills
      };
    });
    
    logger.info('User selected skills', {
      pluginCount: selections.length,
      totalSkills: selections.reduce((sum, s) => sum + s.skills.length, 0)
    });
    
    return { selections };
    
  } catch (error) {
    if (error instanceof UserCancellationError) {
      logger.info('User cancelled skill selection');
      return { selections: [] };
    }
    throw error;
  }
}

/**
 * Validate and locate requested skills across marketplace plugins for non-interactive mode.
 * 
 * @param skillsCollection - Skills collection map from parseSkillsFromMarketplace
 * @param requestedSkills - Array of skill names to validate
 * @returns Valid selections and invalid skill names
 */
export function validateSkillSelections(
  skillsCollection: SkillsCollectionMap,
  requestedSkills: string[]
): { valid: SkillSelectionResult; invalid: string[] } {
  const { marketplace, pluginSkills } = skillsCollection;
  
  const selectionMap = new Map<string, DiscoveredSkill[]>();
  const invalid: string[] = [];
  
  for (const requestedName of requestedSkills) {
    let found = false;
    
    // Search across all plugins
    for (const [pluginName, skills] of pluginSkills.entries()) {
      const skill = findSkillByName(skills, requestedName);
      if (skill) {
        if (!selectionMap.has(pluginName)) {
          selectionMap.set(pluginName, []);
        }
        selectionMap.get(pluginName)!.push(skill);
        found = true;
        break; // Stop after first match (skill names should be unique per marketplace)
      }
    }
    
    if (!found) {
      invalid.push(requestedName);
    }
  }
  
  // Build valid selections structure
  const selections = Array.from(selectionMap.entries()).map(([pluginName, skills]) => {
    const pluginEntry = marketplace.plugins.find(p => p.name === pluginName)!;
    return {
      pluginName,
      pluginEntry,
      skills
    };
  });
  
  logger.debug('Validated skill selections', {
    valid: selections.reduce((sum, s) => sum + s.skills.length, 0),
    invalid: invalid.length
  });
  
  return {
    valid: { selections },
    invalid
  };
}

/**
 * Orchestrate installation of all selected skills from marketplace plugins.
 * 
 * @param marketplaceDir - Absolute path to cloned marketplace repository root
 * @param selections - Skill selection result from prompt or validation
 * @param marketplaceGitUrl - Git URL of the marketplace repository
 * @param marketplaceGitRef - Git ref (branch/tag/sha) if specified
 * @param marketplaceCommitSha - Commit SHA of cached marketplace
 * @param options - Install options
 * @param cwd - Current working directory for installation
 * @returns Overall command result with success/failure counts
 */
export async function installMarketplaceSkills(
  marketplaceDir: string,
  selections: SkillSelectionResult,
  marketplaceGitUrl: string,
  marketplaceGitRef: string | undefined,
  marketplaceCommitSha: string,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const totalSkills = selections.selections.reduce((sum, s) => sum + s.skills.length, 0);
  
  logger.info('Installing marketplace skills', {
    pluginCount: selections.selections.length,
    skillCount: totalSkills
  });
  
  console.log(`Installing ${totalSkills} skill${totalSkills === 1 ? '' : 's'}...`);
  
  const results: Array<{
    name: string;
    pluginName: string;
    success: boolean;
    error?: string;
  }> = [];
  
  for (const selection of selections.selections) {
    for (const skill of selection.skills) {
      try {
        const installResult = await installSingleSkill(
          marketplaceDir,
          selection.pluginEntry,
          skill,
          {
            gitUrl: marketplaceGitUrl,
            gitRef: marketplaceGitRef,
            commitSha: marketplaceCommitSha
          },
          options,
          cwd
        );
        
        if (installResult.success) {
          console.log(`✓ ${skill.name} (from ${selection.pluginName})`);
          results.push({
            name: skill.name,
            pluginName: selection.pluginName,
            success: true
          });
        } else {
          console.error(`❌ ${skill.name} (from ${selection.pluginName}): ${installResult.error || 'Unknown error'}`);
          results.push({
            name: skill.name,
            pluginName: selection.pluginName,
            success: false,
            error: installResult.error
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Failed to install skill', {
          skill: skill.name,
          plugin: selection.pluginName,
          error: errorMsg
        });
        console.error(`❌ ${skill.name} (from ${selection.pluginName}): ${errorMsg}`);
        results.push({
          name: skill.name,
          pluginName: selection.pluginName,
          success: false,
          error: errorMsg
        });
      }
    }
  }
  
  // Display summary
  displaySkillInstallationSummary(results);
  
  // Return success if at least one skill was installed
  const anySuccess = results.some(r => r.success);
  return {
    success: anySuccess,
    error: !anySuccess ? 'Failed to install any skills from marketplace' : undefined
  };
}

/**
 * Install a single skill from a marketplace plugin.
 * 
 * @param marketplaceDir - Absolute path to cloned marketplace repository root
 * @param pluginEntry - Marketplace plugin entry
 * @param skill - Discovered skill to install
 * @param gitContext - Git source context for manifest recording
 * @param options - Install options
 * @param cwd - Current working directory for installation
 * @returns Command result for this skill installation
 */
async function installSingleSkill(
  marketplaceDir: string,
  pluginEntry: MarketplacePluginEntry,
  skill: DiscoveredSkill,
  gitContext: {
    gitUrl: string;
    gitRef: string | undefined;
    commitSha: string;
  },
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const spinner = new Spinner(`Installing ${skill.name}`);
  spinner.start();
  
  try {
    // Normalize plugin source to get relative path
    const normalizedSource = normalizePluginSource(pluginEntry.source, pluginEntry.name);
    
    if (!isRelativePathSource(normalizedSource)) {
      throw new Error('Git source plugins not yet supported for skills installation');
    }
    
    // Compute plugin directory path
    const pluginSubdir = normalizedSource.relativePath!;
    const pluginDir = join(marketplaceDir, pluginSubdir);
    
    // Build complete skill path (plugin path + skill path)
    const completeSkillPath = join(pluginSubdir, skill.skillPath).replace(/\\/g, '/');
    
    logger.debug('Installing skill from marketplace plugin', {
      skillName: skill.name,
      pluginName: pluginEntry.name,
      pluginDir,
      skillPath: skill.skillPath,
      completeSkillPath
    });
    
    // Build naming context for the skill
    const namingContext = new SkillContextBuilder()
      .withGit(gitContext.gitUrl, gitContext.gitRef, completeSkillPath)
      .withPhysical(pluginDir)
      .withSkillInfo(skill.name, pluginSubdir, skill.skillPath)
      .withMarketplace(
        '' /* marketplace name not needed for naming */,
        gitContext.commitSha,
        pluginEntry.name
      )
      .build();
    
    // Resolve canonical package name using service
    const canonicalName = PackageNameService.resolvePackageName(namingContext);
    
    logger.debug('Resolved canonical skill name', {
      canonicalName,
      gitPath: completeSkillPath
    });
    
    // Build install context pointing to PLUGIN directory with skill filter
    const { buildPathInstallContext } = await import('./unified/context-builders.js');
    const ctx = await buildPathInstallContext(
      cwd,
      pluginDir,
      {
        ...options,
        sourceType: 'directory' as const,
        skillFilter: skill.skillPath,
        skillMetadata: {
          name: skill.name,
          skillPath: skill.skillPath
        }
      }
    );
    
    // Set git source override for manifest recording (using complete path)
    ctx.source.gitSourceOverride = {
      gitUrl: gitContext.gitUrl,
      gitRef: gitContext.gitRef,
      gitPath: completeSkillPath  // ✅ Complete path
    };
    
    // Store skill metadata AND naming context in context for loader
    ctx.source.pluginMetadata = {
      isPlugin: false,
      isSkill: true,
      skillMetadata: {
        skill,
        pluginName: pluginEntry.name
      }
    };
    
    // Store naming context for downstream use
    (ctx.source as any)._namingContext = namingContext;
    
    // Stop spinner before pipeline execution
    spinner.stop();
    
    // Run unified installation pipeline
    const { runUnifiedInstallPipeline } = await import('./unified/pipeline.js');
    const pipelineResult = await runUnifiedInstallPipeline(ctx);
    
    return {
      success: pipelineResult.success,
      error: pipelineResult.error
    };
    
  } catch (error) {
    spinner.stop();
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Skill installation failed', {
      skill: skill.name,
      error: errorMsg
    });
    return {
      success: false,
      error: errorMsg
    };
  }
}

/**
 * Display installation summary for skills.
 */
function displaySkillInstallationSummary(
  results: Array<{
    name: string;
    pluginName: string;
    success: boolean;
    error?: string;
  }>
): void {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log('');
  
  if (successful.length > 0) {
    console.log(`✓ Successfully installed: ${successful.length} skill${successful.length === 1 ? '' : 's'}`);
  }
  
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length} skill${failed.length === 1 ? '' : 's'}`);
    for (const result of failed) {
      console.log(`  ${result.name} (from ${result.pluginName}): ${result.error}`);
    }
  }
}
