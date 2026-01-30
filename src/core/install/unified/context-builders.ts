import { basename } from 'path';
import type { InstallOptions } from '../../../types/index.js';
import type { InstallationContext, PackageSource } from './context.js';
import { classifyPackageInput } from '../../../utils/package-input.js';
import { normalizePlatforms } from '../../../utils/platform-mapper.js';
import { parsePackageYml } from '../../../utils/package-yml.js';
import { getLocalPackageYmlPath, getLocalOpenPackageDir } from '../../../utils/paths.js';
import { exists } from '../../../utils/fs.js';
import { createWorkspacePackageYml, ensureLocalOpenPackageStructure } from '../../../utils/package-management.js';
import { logger } from '../../../utils/logger.js';
import { resolveDeclaredPath } from '../../../utils/path-resolution.js';
import { parseSkillPath, getSkillFilterPath } from '../skill-path-parser.js';

/**
 * Build context for registry-based installation
 */
export async function buildRegistryInstallContext(
  cwd: string,
  packageName: string,
  options: InstallOptions & { version?: string; registryPath?: string }
): Promise<InstallationContext> {
  const source: PackageSource = {
    type: 'registry',
    packageName,
    version: options.version,
    registryPath: options.registryPath
  };
  
  return {
    source,
    mode: 'install',
    options,
    platforms: normalizePlatforms(options.platforms) || [],
    cwd,
    targetDir: '.',
    resolvedPackages: [],
    warnings: [],
    errors: []
  };
}

/**
 * Build context for path-based installation
 */
export async function buildPathInstallContext(
  cwd: string,
  sourcePath: string,
  options: InstallOptions & { 
    sourceType: 'directory' | 'tarball';
    skillFilter?: string;
    skillMetadata?: { name: string; skillPath: string };
  }
): Promise<InstallationContext> {
  // Auto-detect skill filter if not provided
  // This handles cases where a package name resolves to a skill directory path
  let skillFilter = options.skillFilter;
  
  if (!skillFilter && options.sourceType === 'directory') {
    // Check if the path itself indicates this is a skill
    // Extract the relative path portion that might contain "/skills/"
    const skillInfo = parseSkillPath(sourcePath);
    if (skillInfo.isSkill) {
      skillFilter = getSkillFilterPath(skillInfo);
      logger.debug('Auto-detected skill filter from resolved path', {
        sourcePath,
        skillFilter,
        skillName: skillInfo.skillName
      });
    }
  }
  
  // Will need to load package to get name
  // For now, we'll populate after loading
  const source: PackageSource = {
    type: 'path',
    packageName: '', // Populated after loading
    localPath: sourcePath,
    sourceType: options.sourceType,
    skillFilter
  };
  
  return {
    source,
    mode: 'install',
    options,
    platforms: normalizePlatforms(options.platforms) || [],
    cwd,
    targetDir: '.',
    resolvedPackages: [],
    warnings: [],
    errors: []
  };
}

/**
 * Build context for git-based installation
 */
export async function buildGitInstallContext(
  cwd: string,
  gitUrl: string,
  options: InstallOptions & { gitRef?: string; gitPath?: string; skillFilter?: string }
): Promise<InstallationContext> {
  const source: PackageSource = {
    type: 'git',
    packageName: '', // Populated after loading
    gitUrl,
    gitRef: options.gitRef,
    gitPath: options.gitPath,
    skillFilter: options.skillFilter
  };
  
  return {
    source,
    mode: 'install',
    options,
    platforms: normalizePlatforms(options.platforms) || [],
    cwd,
    targetDir: '.',
    resolvedPackages: [],
    warnings: [],
    errors: []
  };
}

/**
 * Build context for workspace root installation
 * Used when installing/applying workspace-level files from .openpackage/
 */
export async function buildWorkspaceRootInstallContext(
  cwd: string,
  options: InstallOptions,
  mode: 'install' | 'apply' = 'install'
): Promise<InstallationContext | null> {
  // Ensure .openpackage/ structure exists
  await ensureLocalOpenPackageStructure(cwd);
  
  // Create workspace manifest if it doesn't exist
  await createWorkspacePackageYml(cwd);
  
  const openpackageDir = getLocalOpenPackageDir(cwd);
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  
  // Check if workspace manifest exists
  if (!(await exists(packageYmlPath))) {
    logger.debug('No workspace manifest found, skipping workspace root context');
    return null;
  }
  
  // Load workspace manifest
  let config;
  try {
    config = await parsePackageYml(packageYmlPath);
  } catch (error) {
    logger.warn(`Failed to read workspace manifest: ${error}`);
    return null;
  }
  
  // Use workspace directory name as package name if not specified in manifest
  const packageName = config.name || basename(cwd);
  
  const source: PackageSource = {
    type: 'workspace',
    packageName,
    version: config.version,
    contentRoot: openpackageDir
  };
  
  return {
    source,
    mode,
    options: mode === 'apply' ? { ...options, force: true } : options,
    platforms: normalizePlatforms(options.platforms) || [],
    cwd,
    targetDir: '.',
    resolvedPackages: [],
    warnings: [],
    errors: []
  };
}



/**
 * Build context from package input (auto-detect type)
 */
export async function buildInstallContext(
  cwd: string,
  packageInput: string | undefined,
  options: InstallOptions
): Promise<InstallationContext | InstallationContext[]> {
  // No input = bulk install
  if (!packageInput) {
    return buildBulkInstallContexts(cwd, options);
  }
  
  // Classify input to determine source type
  const classification = await classifyPackageInput(packageInput, cwd);
  
  switch (classification.type) {
    case 'registry':
      return buildRegistryInstallContext(cwd, classification.name!, options);
    
    case 'directory':
    case 'tarball': {
      // Check if the original package input (name) contains skill information
      // This handles: opkg install ghwshobson/agents/plugins/ui-design/skills/mobile-ios-design
      // which resolves to path: ~/.cache/.../plugins/ui-design (parent)
      // We need to extract skill filter from the NAME, not the path
      const skillInfo = parseSkillPath(packageInput);
      const skillFilter = skillInfo.isSkill ? getSkillFilterPath(skillInfo) : undefined;
      
      if (skillFilter) {
        logger.debug('Detected skill filter from package name', {
          packageInput,
          skillFilter,
          resolvedPath: classification.resolvedPath
        });
      }
      
      return buildPathInstallContext(cwd, classification.resolvedPath!, {
        ...options,
        sourceType: classification.type,
        skillFilter
      });
    }
    
    case 'git': {
      // Check if the package input (name) or gitPath contains skill information
      // This handles: opkg install ghwshobson/agents/plugins/ui-design/skills/mobile-ios-design
      // which is classified as git but may contain skill path
      const skillInfoFromInput = parseSkillPath(packageInput);
      const skillInfoFromGitPath = parseSkillPath(classification.gitPath);
      
      // Prefer skill info from gitPath if available, otherwise from packageInput
      const skillInfo = skillInfoFromGitPath.isSkill ? skillInfoFromGitPath : skillInfoFromInput;
      const skillFilter = skillInfo.isSkill ? getSkillFilterPath(skillInfo) : undefined;
      
      if (skillFilter) {
        logger.debug('Detected skill filter from git source', {
          packageInput,
          gitPath: classification.gitPath,
          skillFilter
        });
      }
      
      return buildGitInstallContext(cwd, classification.gitUrl!, {
        ...options,
        gitRef: classification.gitRef,
        gitPath: classification.gitPath,
        skillFilter
      });
    }
    
    default:
      throw new Error(`Unknown package input type: ${classification.type}`);
  }
}

/**
 * Build contexts for bulk installation
 */
async function buildBulkInstallContexts(
  cwd: string,
  options: InstallOptions
): Promise<InstallationContext[]> {
  const contexts: InstallationContext[] = [];
  
  // First, try to build workspace root context
  const workspaceContext = await buildWorkspaceRootInstallContext(cwd, options, 'install');
  if (workspaceContext) {
    contexts.push(workspaceContext);
  }
  
  // Ensure workspace manifest exists before reading
  await createWorkspacePackageYml(cwd);
  
  // Read openpackage.yml and create context for each package
  const opkgYmlPath = getLocalPackageYmlPath(cwd);
  const opkgYml = await parsePackageYml(opkgYmlPath);
  
  // Get workspace package name to exclude it from bulk install
  const workspacePackageName = workspaceContext?.source.packageName;
  
  // Helper function to process dependencies
  const processDependencies = (deps: typeof opkgYml.dependencies) => {
    if (!deps || deps.length === 0) return;
    
    for (const dep of deps) {
      // Skip if this package matches the workspace package name
      if (workspacePackageName && dep.name === workspacePackageName) {
        logger.debug(`Skipping workspace package '${dep.name}' from bulk install`);
        continue;
      }
      
      let source: PackageSource;
      
      if (dep.git || dep.url) {
        // Git source - handle both old (git) and new (url) formats
        const gitUrlRaw = dep.url || dep.git!;
        
        // Parse url field to extract ref if embedded
        const [gitUrl, embeddedRef] = gitUrlRaw.includes('#') 
          ? gitUrlRaw.split('#', 2)
          : [gitUrlRaw, undefined];
        
        // Use embedded ref if present, otherwise fall back to separate ref field
        const gitRef = embeddedRef || dep.ref;
        
        // Detect if path points to a skill
        const skillInfo = parseSkillPath(dep.path);
        const skillFilter = getSkillFilterPath(skillInfo);
        
        source = {
          type: 'git',
          packageName: dep.name,
          gitUrl,
          gitRef,
          gitPath: dep.path,
          skillFilter
        };
        
        // Log skill detection for debugging
        if (skillInfo.isSkill) {
          logger.debug('Detected skill in bulk install manifest', {
            packageName: dep.name,
            gitPath: dep.path,
            skillFilter,
            skillName: skillInfo.skillName,
            parentPath: skillInfo.parentPath
          });
        }
      } else if (dep.path) {
        // Path source - resolve tilde paths before creating source
        const resolved = resolveDeclaredPath(dep.path, cwd);
        const isTarball = dep.path.endsWith('.tgz') || dep.path.endsWith('.tar.gz');
        
        // Detect if path points to a skill subdirectory
        // Note: For local paths, we detect based on path structure
        const skillInfo = parseSkillPath(dep.path);
        const skillFilter = getSkillFilterPath(skillInfo);
        
        source = {
          type: 'path',
          packageName: dep.name,
          localPath: resolved.absolute,
          sourceType: isTarball ? 'tarball' : 'directory',
          skillFilter
        };
        
        // Log skill detection for debugging
        if (skillInfo.isSkill) {
          logger.debug('Detected skill in bulk install manifest (path source)', {
            packageName: dep.name,
            localPath: dep.path,
            skillFilter,
            skillName: skillInfo.skillName,
            parentPath: skillInfo.parentPath
          });
        }
      } else {
        // Registry source
        source = {
          type: 'registry',
          packageName: dep.name,
          version: dep.version
        };
      }
      
      contexts.push({
        source,
        mode: 'install',
        options,
        platforms: normalizePlatforms(options.platforms) || [],
        cwd,
        targetDir: '.',
        resolvedPackages: [],
        warnings: [],
        errors: []
      });
    }
  };
  
  // Process regular dependencies (using new field name)
  processDependencies(opkgYml.dependencies);
  
  // Process dev-dependencies (using new field name)
  processDependencies(opkgYml['dev-dependencies']);
  
  return contexts;
}


