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
import { parseContentPath, getContentFilterPath } from '../content-path-parser.js';
import type { ContentType } from '../content-type-registry.js';

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
    contentFilter?: string;
    contentType?: ContentType;
    skillMetadata?: { name: string; skillPath: string };
  }
): Promise<InstallationContext> {
  // Auto-detect content filter if not provided
  // This handles cases where a package name resolves to a content directory path
  let contentFilter = options.contentFilter;
  let contentType = options.contentType;
  
  if (!contentFilter && options.sourceType === 'directory') {
    // Check if the path itself indicates this is content (skill, agent, etc.)
    const contentInfo = parseContentPath(sourcePath);
    if (contentInfo.isContent) {
      contentFilter = getContentFilterPath(contentInfo);
      contentType = contentInfo.contentType;
      logger.debug('Auto-detected content filter from resolved path', {
        sourcePath,
        contentFilter,
        contentType,
        contentName: contentInfo.contentName
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
    contentFilter,
    contentType
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
  options: InstallOptions & { 
    gitRef?: string; 
    gitPath?: string; 
    contentFilter?: string;
    contentType?: ContentType;
  }
): Promise<InstallationContext> {
  const source: PackageSource = {
    type: 'git',
    packageName: '', // Populated after loading
    gitUrl,
    gitRef: options.gitRef,
    gitPath: options.gitPath,
    contentFilter: options.contentFilter,
    contentType: options.contentType
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
      // Check if the original package input (name) contains content information (skills, agents, etc.)
      // This handles: opkg install ghwshobson/agents/plugins/ui-design/skills/mobile-ios-design
      // which resolves to path: ~/.cache/.../plugins/ui-design (parent)
      // We need to extract content filter from the NAME, not the path
      const contentInfo = parseContentPath(packageInput);
      const contentFilter = contentInfo.isContent ? getContentFilterPath(contentInfo) : undefined;
      const contentType = contentInfo.contentType;
      
      if (contentFilter) {
        logger.debug('Detected content filter from package name', {
          packageInput,
          contentFilter,
          contentType,
          resolvedPath: classification.resolvedPath
        });
      }
      
      return buildPathInstallContext(cwd, classification.resolvedPath!, {
        ...options,
        sourceType: classification.type,
        contentFilter,
        contentType
      });
    }
    
    case 'git': {
      // Check if the gitPath contains content information (skills, agents, etc.)
      //
      // IMPORTANT: Do NOT parse the full user input here (e.g. "gh@owner/repo/...") because
      // repo names like "agents" can be misinterpreted as a content directory ("agents/"),
      // producing bogus filters like "agents/plugins/...".
      const contentInfoFromGitPath = parseContentPath(classification.gitPath);
      
      const contentInfo = contentInfoFromGitPath;
      const contentFilter = contentInfo.isContent ? getContentFilterPath(contentInfo) : undefined;
      const contentType = contentInfo.contentType;
      
      if (contentFilter) {
        logger.debug('Detected content filter from git source', {
          packageInput,
          gitPath: classification.gitPath,
          contentFilter,
          contentType
        });
      }
      
      return buildGitInstallContext(cwd, classification.gitUrl!, {
        ...options,
        gitRef: classification.gitRef,
        gitPath: classification.gitPath,
        contentFilter,
        contentType
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
  const seenKeys = new Set<string>();
  
  // First, try to build workspace root context
  const workspaceContext = await buildWorkspaceRootInstallContext(cwd, options, 'install');
  if (workspaceContext) {
    workspaceContext.source.fromWorkspaceManifest = true;
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
      let dedupeKey: string;
      
      if (dep.git || dep.url) {
        // Git source - handle both old (git) and new (url) formats
        const gitUrlRaw = dep.url || dep.git!;
        
        // Parse url field to extract ref if embedded
        const [gitUrl, embeddedRef] = gitUrlRaw.includes('#') 
          ? gitUrlRaw.split('#', 2)
          : [gitUrlRaw, undefined];
        
        // Use embedded ref if present, otherwise fall back to separate ref field
        const gitRef = embeddedRef || dep.ref;
        
        // Detect if path points to content (skills, agents, etc.)
        const contentInfo = parseContentPath(dep.path);
        const contentFilter = getContentFilterPath(contentInfo);
        const contentType = contentInfo.contentType;
        
        source = {
          type: 'git',
          packageName: dep.name,
          gitUrl,
          gitRef,
          gitPath: dep.path,
          contentFilter,
          contentType,
          fromWorkspaceManifest: true
        };
        dedupeKey = `git|${gitUrl}|${gitRef ?? ''}|${dep.path ?? ''}`;
        
        // Log content detection for debugging
        if (contentInfo.isContent) {
          logger.debug('Detected content in bulk install manifest', {
            packageName: dep.name,
            gitPath: dep.path,
            contentFilter,
            contentType,
            contentName: contentInfo.contentName,
            parentPath: contentInfo.parentPath
          });
        }
      } else if (dep.path) {
        // Path source - resolve tilde paths before creating source
        const resolved = resolveDeclaredPath(dep.path, cwd);
        const isTarball = dep.path.endsWith('.tgz') || dep.path.endsWith('.tar.gz');
        
        // Detect if path points to a content subdirectory
        // Note: For local paths, we detect based on path structure
        const contentInfo = parseContentPath(dep.path);
        const contentFilter = getContentFilterPath(contentInfo);
        const contentType = contentInfo.contentType;
        
        source = {
          type: 'path',
          packageName: dep.name,
          localPath: resolved.absolute,
          sourceType: isTarball ? 'tarball' : 'directory',
          contentFilter,
          contentType,
          fromWorkspaceManifest: true
        };
        dedupeKey = `path|${resolved.absolute}`;
        
        // Log content detection for debugging
        if (contentInfo.isContent) {
          logger.debug('Detected content in bulk install manifest (path source)', {
            packageName: dep.name,
            localPath: dep.path,
            contentFilter,
            contentType,
            contentName: contentInfo.contentName,
            parentPath: contentInfo.parentPath
          });
        }
      } else {
        // Registry source
        source = {
          type: 'registry',
          packageName: dep.name,
          version: dep.version,
          fromWorkspaceManifest: true
        };
        dedupeKey = `registry|${dep.name}|${dep.version ?? ''}`;
      }
      
      if (seenKeys.has(dedupeKey)) {
        logger.warn('Skipping duplicate dependency entry in openpackage.yml', {
          name: dep.name,
          dedupeKey
        });
        continue;
      }
      seenKeys.add(dedupeKey);

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


