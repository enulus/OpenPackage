import { basename, join, relative } from 'path';
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
import type { ResourceInstallationSpec } from '../convenience-matchers.js';

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
  options: InstallOptions & { sourceType: 'directory' | 'tarball' }
): Promise<InstallationContext> {
  // Will need to load package to get name
  // For now, we'll populate after loading
  const source: PackageSource = {
    type: 'path',
    packageName: '', // Populated after loading
    localPath: sourcePath,
    sourceType: options.sourceType
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
  options: InstallOptions & { gitRef?: string; gitPath?: string }
): Promise<InstallationContext> {
  const source: PackageSource = {
    type: 'git',
    packageName: '', // Populated after loading
    gitUrl,
    gitRef: options.gitRef,
    gitPath: options.gitPath
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
    case 'tarball':
      return buildPathInstallContext(cwd, classification.resolvedPath!, {
        ...options,
        sourceType: classification.type
      });
    
    case 'git':
      return buildGitInstallContext(cwd, classification.gitUrl!, {
        ...options,
        gitRef: classification.gitRef,
        gitPath: classification.gitPath
      });
    
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
  
  if (opkgYml.packages && opkgYml.packages.length > 0) {
    for (const dep of opkgYml.packages) {
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
        
        source = {
          type: 'git',
          packageName: dep.name,
          gitUrl,
          gitRef,
          gitPath: dep.path,
          manifestBase: dep.base  // Phase 5: Pass manifest base to source
        };
      } else if (dep.path) {
        // Path source - resolve tilde paths before creating source
        const resolved = resolveDeclaredPath(dep.path, cwd);
        const isTarball = dep.path.endsWith('.tgz') || dep.path.endsWith('.tar.gz');
        
        source = {
          type: 'path',
          packageName: dep.name,
          localPath: resolved.absolute,
          sourceType: isTarball ? 'tarball' : 'directory',
          manifestBase: dep.base  // Phase 5: Pass manifest base to source
        };
      } else {
        // Registry source
        source = {
          type: 'registry',
          packageName: dep.name,
          version: dep.version,
          manifestBase: dep.base  // Phase 5: Pass manifest base to source
        };
      }
      
      // Phase 5: Create context with base field from manifest if present
      const context: InstallationContext = {
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
      
      // Phase 5: Store base from manifest for reproducibility
      // When base is present, skip base detection and use manifest value
      if (dep.base) {
        context.baseRelative = dep.base;
        context.baseSource = 'manifest';
        logger.debug(`Using base from manifest for ${dep.name}`, { base: dep.base });
      }
      
      contexts.push(context);
    }
  }
  
  return contexts;
}

/**
 * Build context from a ResourceSpec (Phase 3: Resource Model)
 */
export async function buildResourceInstallContext(
  cwd: string,
  resourceSpec: any, // ResourceSpec from resource-arg-parser
  options: InstallOptions
): Promise<InstallationContext> {
  let source: PackageSource;
  
  switch (resourceSpec.type) {
    case 'github-url':
    case 'github-shorthand':
      // Git source with resource path
      source = {
        type: 'git',
        packageName: '', // Populated after loading
        gitUrl: resourceSpec.gitUrl!,
        gitRef: resourceSpec.ref,
        // IMPORTANT: In resource-mode, `resourceSpec.path` represents a resource filter
        // (file or directory) within the repo, NOT a git subdirectory to clone into.
        // `gitPath` is reserved for "package lives in subdirectory" semantics (legacy/manifest).
        resourcePath: resourceSpec.path // Store resource path for base detection + scoping
      };
      break;
    
    case 'registry':
      // Registry source with optional path
      source = {
        type: 'registry',
        packageName: resourceSpec.name!,
        version: resourceSpec.version,
        resourcePath: resourceSpec.path
      };
      break;
    
    case 'filepath':
      // Local path source
      const absolutePath = resourceSpec.absolutePath!;
      const relativePath = relative(cwd, absolutePath).replace(/\\/g, '/');
      const resourcePath = relativePath.startsWith('..') ? basename(absolutePath) : relativePath;
      source = {
        type: 'path',
        packageName: '', // Populated after loading
        localPath: absolutePath,
        sourceType: resourceSpec.isDirectory ? 'directory' : 'tarball',
        resourcePath
      };
      break;
    
    default:
      throw new Error(`Unknown resource type: ${resourceSpec.type}`);
  }
  
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

function buildResourceMatchedPattern(
  resourceSpec: ResourceInstallationSpec,
  repoRoot: string,
  basePath: string
): string | undefined {
  const absoluteResourcePath = join(repoRoot, resourceSpec.resourcePath);
  const relativeToBase = relative(basePath, absoluteResourcePath)
    .replace(/\\/g, '/')
    .replace(/^\.\/?/, '');

  if (!relativeToBase) {
    return undefined;
  }

  if (resourceSpec.resourceKind === 'directory') {
    const normalized = relativeToBase.replace(/\/$/, '');
    return `${normalized}/**`;
  }

  return relativeToBase;
}

/**
 * Build multiple contexts for resource-centric installations.
 */
export function buildResourceInstallContexts(
  baseContext: InstallationContext,
  resourceSpecs: ResourceInstallationSpec[],
  repoRoot: string
): InstallationContext[] {
  const detectedBase = baseContext.detectedBase ?? baseContext.source.contentRoot ?? baseContext.cwd;
  const baseRelative = baseContext.baseRelative ?? (relative(repoRoot, detectedBase) || '.');

  return resourceSpecs.map(spec => {
    const source: PackageSource = {
      ...baseContext.source,
      resourcePath: spec.resourcePath
    };

    const effectiveBase = baseContext.detectedBase ?? spec.basePath;

    return {
      ...baseContext,
      source,
      resolvedPackages: [],
      warnings: [],
      errors: [],
      detectedBase: effectiveBase,
      baseRelative: baseRelative === '' ? '.' : baseRelative,
      baseSource: baseContext.baseSource,
      matchedPattern: buildResourceMatchedPattern(spec, repoRoot, effectiveBase) ?? baseContext.matchedPattern
    };
  });
}


