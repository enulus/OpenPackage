import { relative, basename } from 'path';
import { readFile } from 'fs/promises';
import { Package, PackageFile, PackageYml } from '../../types/index.js';
import { loadPackageConfig } from '../package-context.js';
import { extractPackageFromTarball } from '../../utils/tarball.js';
import { walkFiles, readTextFile } from '../../utils/fs.js';
import { isJunk } from 'junk';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { FILE_PATTERNS, PACKAGE_PATHS, CLAUDE_PLUGIN_PATHS } from '../../constants/index.js';
import { detectPluginType, detectPluginWithMarketplace } from './plugin-detector.js';
import { transformPluginToPackage } from './plugin-transformer.js';
import type { MarketplacePluginEntry } from './marketplace-handler.js';
import { resolvePackageNameFromContext, createSkillResolutionContext } from '../../utils/package-name-resolver.js';
import { generateGitHubPackageName } from '../../utils/plugin-naming.js';
import { PackageNameService } from './package-name-service.js';
import type { PackageNamingContext } from './naming-context.js';
import * as yaml from 'js-yaml';

export type PathSourceType = 'directory' | 'tarball';

/**
 * Context for loading packages with naming information and marketplace metadata.
 */
export interface PackageLoadContext {
  gitUrl?: string;
  path?: string;
  repoPath?: string;
  packageName?: string;  // Optional override (avoid using - let transformer generate)
  marketplaceEntry?: MarketplacePluginEntry;
  
  /** Skill filter - when specified, only load files under this subdirectory path */
  skillFilter?: string;
  
  /** Skill metadata for package name generation (when loading a filtered skill) */
  skillMetadata?: {
    name: string;
    skillPath: string;
  };
}

/**
 * Infer the source type from a path string.
 */
export function inferSourceType(path: string): PathSourceType {
  return path.endsWith(FILE_PATTERNS.TGZ_FILES) || path.endsWith(FILE_PATTERNS.TAR_GZ_FILES) ? 'tarball' : 'directory';
}

/**
 * Filter package files to only those under a specific subdirectory path.
 * Used for installing individual skills from skills collections.
 * 
 * @param files - All package files
 * @param filterPath - Subdirectory path (e.g., "skills/git" or "plugins/ui-design/skills/mobile-ios-design")
 * @returns Filtered files that start with filterPath
 */
function filterFilesToSubdirectory(files: PackageFile[], filterPath: string): PackageFile[] {
  // Normalize filter path to ensure it ends with /
  const normalizedFilter = filterPath.endsWith('/') ? filterPath : filterPath + '/';
  
  return files.filter(f => f.path.startsWith(normalizedFilter));
}

/**
 * Load a package from a local directory.
 * Reads all files from the directory and loads openpackage.yml.
 * 
 * If the directory is a Claude Code plugin, transforms it to OpenPackage format.
 * 
 * @param dirPath - Path to directory
 * @param context - Optional context for scoped naming (GitHub URL, subdirectory)
 */
export async function loadPackageFromDirectory(
  dirPath: string,
  context?: PackageLoadContext
): Promise<Package> {
  logger.debug(`Loading package from directory: ${dirPath}`, { context });
  
  // Check if this is a Claude Code plugin (with marketplace context if available)
  const pluginDetection = await detectPluginWithMarketplace(dirPath, context?.marketplaceEntry);
  
  if (pluginDetection.isPlugin && (pluginDetection.type === 'individual' || pluginDetection.type === 'marketplace-defined')) {
    logger.info(`Detected Claude Code plugin (${pluginDetection.type}), transforming to OpenPackage format`, { dirPath });
    const { package: pkg } = await transformPluginToPackage(dirPath, context);
    
    // Apply skill filter AFTER plugin transformation if specified
    if (context?.skillFilter && context.skillFilter !== '.') {
      const beforeCount = pkg.files.length;
      
      pkg.files = filterFilesToSubdirectory(pkg.files, context.skillFilter);
      
      logger.info('Applied skill filter after plugin transformation', {
        filter: context.skillFilter,
        beforeCount,
        afterCount: pkg.files.length
      });
      
      if (pkg.files.length === 0) {
        throw new ValidationError(
          `No files found under skill path '${context.skillFilter}' in plugin '${dirPath}'`
        );
      }
      
      // Override package name with skill-specific name
      if (context.skillMetadata) {
        // Check if we have a pre-built naming context (from skills-marketplace-handler)
        const namingContext = (context as any)._namingContext as PackageNamingContext | undefined;
        
        if (namingContext) {
          // Use pre-built context for guaranteed consistency
          const skillPackageName = PackageNameService.resolvePackageName(namingContext);
          pkg.metadata.name = skillPackageName;
          logger.debug('Overrode plugin package name with skill name (from naming context)', {
            skill: skillPackageName
          });
        } else {
          // Fall back to old resolver (for backward compatibility)
          const skillPackageName = resolvePackageNameFromContext(
            createSkillResolutionContext({
              gitUrl: context.gitUrl,
              path: context.path,
              skillName: context.skillMetadata.name,
              skillPath: context.skillMetadata.skillPath,
              repoPath: context.repoPath
            })
          );
          pkg.metadata.name = skillPackageName;
          logger.debug('Overrode plugin package name with skill name (fallback resolver)', {
            skill: skillPackageName
          });
        }
      }
    }
    
    return pkg;
  }
  
  // If it's a marketplace, we need to handle plugin selection (done upstream in install command)
  if (pluginDetection.isPlugin && pluginDetection.type === 'marketplace') {
    throw new ValidationError(
      `Directory '${dirPath}' is a Claude Code plugin marketplace. ` +
      `Marketplace installation requires plugin selection and should be handled by the install command.`
    );
  }
  
  // Check if skill filter is specified - this indicates we're loading a specific skill
  if (context?.skillFilter) {
    logger.debug('Loading with skill filter', { 
      dirPath, 
      skillFilter: context.skillFilter,
      skillMetadata: context.skillMetadata
    });
    
    // Load the parent package/plugin, but we'll filter files afterwards
    // Continue with normal loading flow, filtering happens at the end
  }
  
  // Check if this is a single skill directory (SKILL.md at root) WITHOUT a filter
  // If there's a filter, we're intentionally loading from a parent directory
  if (!context?.skillFilter) {
    const { isSingleSkillDirectory } = await import('./skills-detector.js');
    const isSkill = await isSingleSkillDirectory(dirPath);
    
    if (isSkill) {
      logger.info('Detected single skill at root, loading as skill package', { dirPath });
      
      // Load skill metadata for package name generation
      const { loadSingleSkill } = await import('./skills-detector.js');
      const skill = await loadSingleSkill(dirPath);
      
      // Set skill filter to current directory (.) so we load all files
      // Set skill metadata for package name generation
      const skillContext: PackageLoadContext = {
        ...context,
        skillFilter: '.',  // Load all files from this directory
        skillMetadata: {
          name: skill.name,
          skillPath: '.'
        }
      };
      
      // Continue loading with skill context
      context = skillContext;
    } else {
      // Check if this is a skills collection (multiple skills under skills/)
      const { detectSkillsInDirectory } = await import('./skills-detector.js');
      const skillsDetection = await detectSkillsInDirectory(dirPath);
      const hasOpenPackageYml = await loadPackageConfig(dirPath);
      
      if (skillsDetection.hasSkills && !hasOpenPackageYml) {
        throw new ValidationError(
          `Directory '${dirPath}' is a skills collection with ${skillsDetection.discoveredSkills.length} skill${skillsDetection.discoveredSkills.length === 1 ? '' : 's'}. ` +
          `Skills collections require skill selection using the --skills flag.\n\n` +
          `Available skills: ${skillsDetection.discoveredSkills.map(s => s.name).join(', ')}`
        );
      }
    }
  }
  
  // Load openpackage.yml for regular packages (not required for skill-filtered loads)
  const config = await loadPackageConfig(dirPath);
  
  // If no config and no skill filter, this is an error
  if (!config && !context?.skillFilter) {
    throw new ValidationError(
      `Directory '${dirPath}' is not a valid OpenPackage directory, Claude Code plugin, or skill. ` +
      `Missing ${FILE_PATTERNS.OPENPACKAGE_YML}, ${CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST}, or ${FILE_PATTERNS.SKILL_MD}`
    );
  }

  // Discover all files in the directory
  const files: PackageFile[] = [];
  
  try {
    for await (const fullPath of walkFiles(dirPath)) {
      const relativePath = relative(dirPath, fullPath);
      
      // Filter out junk files
      if (isJunk(basename(relativePath))) {
        continue;
      }
      
      const content = await readTextFile(fullPath);
      
      files.push({
        path: relativePath,
        content,
        encoding: 'utf8'
      });
    }
    
    logger.debug(`Loaded ${files.length} files from directory: ${dirPath}`);
    
    // Apply skill filter if specified
    let finalFiles = files;
    if (context?.skillFilter && context.skillFilter !== '.') {
      const beforeCount = files.length;
      finalFiles = filterFilesToSubdirectory(files, context.skillFilter);
      logger.info('Applied skill filter', {
        filter: context.skillFilter,
        beforeCount,
        afterCount: finalFiles.length
      });
      
      if (finalFiles.length === 0) {
        throw new ValidationError(
          `No files found under skill path '${context.skillFilter}' in directory '${dirPath}'`
        );
      }
    }
    
    // Generate package metadata
    let finalConfig: PackageYml;
    
    if (context?.skillMetadata) {
      // This is a skill - check for pre-built naming context first
      const namingContext = (context as any)._namingContext as PackageNamingContext | undefined;
      let packageName: string;
      
      if (namingContext) {
        // Use pre-built context for guaranteed consistency
        packageName = PackageNameService.resolvePackageName(namingContext);
        logger.debug('Generated skill package name (from naming context)', {
          packageName,
          gitPath: namingContext.git.path
        });
      } else {
        // Fall back to old resolver
        logger.debug('Resolving skill package name with unified resolver (fallback)', {
          contextPath: context.path,
          skillMetadataSkillPath: context.skillMetadata.skillPath,
          skillMetadataName: context.skillMetadata.name,
          gitUrl: context.gitUrl
        });
        
        packageName = resolvePackageNameFromContext(
          createSkillResolutionContext({
            gitUrl: context.gitUrl,
            path: context.path,
            skillName: context.skillMetadata.name,
            skillPath: context.skillMetadata.skillPath,
            repoPath: context.repoPath
          })
        );
      }
      
      // Use existing config or create minimal config for skill
      finalConfig = config || {
        name: packageName,
        version: '0.0.0'
      };
      
      // Override name with skill-specific scoped name
      finalConfig.name = packageName;
      
      logger.debug('Final skill package configuration', {
        name: finalConfig.name,
        version: finalConfig.version
      });
    } else if (config) {
      // Regular package - apply GitHub scoping if needed
      finalConfig = config;
      
      if (context?.gitUrl) {
        const originalName = config.name;
        const scopedName = generateGitHubPackageName({
          gitUrl: context.gitUrl,
          path: context.path,
          packageName: originalName,
          repoPath: context.repoPath
        });
        
        // Only override if GitHub scoping was applied (name changed)
        if (scopedName !== originalName) {
          finalConfig.name = scopedName;
          logger.debug('Applied GitHub scoping to OpenPackage repo', {
            original: originalName,
            scoped: scopedName,
            gitUrl: context.gitUrl,
            path: context.path
          });
        }
      }
    } else {
      // Should not reach here
      throw new ValidationError(`No package configuration available for '${dirPath}'`);
    }
    
    return {
      metadata: finalConfig,
      files: finalFiles
    };
  } catch (error) {
    logger.error(`Failed to load package from directory: ${dirPath}`, { error });
    throw new ValidationError(`Failed to load package from directory: ${error}`);
  }
}

/**
 * Load a package from a tarball file.
 * Extracts to a temporary location, reads files, then cleans up.
 */
export async function loadPackageFromTarball(tarballPath: string): Promise<Package> {
  logger.debug(`Loading package from tarball: ${tarballPath}`);
  
  // Read tarball file
  let tarballBuffer: Buffer;
  try {
    tarballBuffer = await readFile(tarballPath);
  } catch (error) {
    throw new ValidationError(`Failed to read tarball file '${tarballPath}': ${error}`);
  }
  
  // Extract tarball
  const extracted = await extractPackageFromTarball(tarballBuffer);
  
  // Find openpackage.yml in extracted files
  const packageYmlFile = extracted.files.find(
    f => f.path === PACKAGE_PATHS.MANIFEST_RELATIVE || f.path === 'openpackage.yml'
  );
  
  if (!packageYmlFile) {
    throw new ValidationError(
      `Tarball '${tarballPath}' does not contain a valid ${FILE_PATTERNS.OPENPACKAGE_YML} file`
    );
  }
  
  // Parse openpackage.yml content
  const config = yaml.load(packageYmlFile.content) as PackageYml;
  
  if (!config.name) {
    throw new ValidationError(
      `Tarball '${tarballPath}' contains invalid ${FILE_PATTERNS.OPENPACKAGE_YML}: missing name field`
    );
  }
  
  logger.debug(`Loaded package ${config.name}@${config.version} from tarball: ${tarballPath}`);
  
  return {
    metadata: config,
    files: extracted.files
  };
}

/**
 * Load a package from either a directory or tarball path.
 * Automatically detects the source type.
 * 
 * @param path - Path to package
 * @param context - Optional context for scoped naming
 */
export async function loadPackageFromPath(
  path: string,
  context?: PackageLoadContext
): Promise<Package> {
  const sourceType = inferSourceType(path);
  
  if (sourceType === 'tarball') {
    return await loadPackageFromTarball(path);
  } else {
    return await loadPackageFromDirectory(path, context);
  }
}

