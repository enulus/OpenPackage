import { basename, join, relative } from 'path';
import type { InstallOptions, ExecutionContext } from '../../../types/index.js';
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
 * Result of building contexts for bulk install.
 * Workspace root is separate from dependency contexts so the orchestrator can run it as a distinct stage.
 */
export interface BulkInstallContextsResult {
  workspaceContext: InstallationContext | null;
  dependencyContexts: InstallationContext[];
}

/**
 * Build context for registry-based installation
 */
export async function buildRegistryInstallContext(
  execContext: ExecutionContext,
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
    execution: execContext,
    targetDir: execContext.targetDir,
    source,
    mode: 'install',
    options,
    platforms: normalizePlatforms(options.platforms) || [],
    resolvedPackages: [],
    warnings: [],
    errors: []
  };
}

/**
 * Build context for path-based installation
 */
export async function buildPathInstallContext(
  execContext: ExecutionContext,
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
    execution: execContext,
    targetDir: execContext.targetDir,
    source,
    mode: 'install',
    options,
    platforms: normalizePlatforms(options.platforms) || [],
    resolvedPackages: [],
    warnings: [],
    errors: []
  };
}

/**
 * Build context for git-based installation
 */
export async function buildGitInstallContext(
  execContext: ExecutionContext,
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
    execution: execContext,
    targetDir: execContext.targetDir,
    source,
    mode: 'install',
    options,
    platforms: normalizePlatforms(options.platforms) || [],
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
  execContext: ExecutionContext,
  options: InstallOptions,
  mode: 'install' | 'apply' = 'install'
): Promise<InstallationContext | null> {
  const cwd = execContext.targetDir;
  
  // Ensure .openpackage/ structure exists
  await ensureLocalOpenPackageStructure(cwd);
  
  // Create workspace manifest if it doesn't exist
  await createWorkspacePackageYml(cwd);
  
  const openpackageDir = getLocalOpenPackageDir(cwd);
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  
  // Check if workspace manifest exists
  if (!(await exists(packageYmlPath))) {
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
    execution: execContext,
    targetDir: execContext.targetDir,
    source,
    mode,
    options: mode === 'apply' ? { ...options, force: true } : options,
    platforms: normalizePlatforms(options.platforms) || [],
    resolvedPackages: [],
    warnings: [],
    errors: []
  };
}



/**
 * Build context from package input (auto-detect type)
 */
export async function buildInstallContext(
  execContext: ExecutionContext,
  packageInput: string | undefined,
  options: InstallOptions
): Promise<InstallationContext | InstallationContext[] | BulkInstallContextsResult> {
  // No input = bulk install (returns workspace + dependency contexts separately)
  if (!packageInput) {
    return buildBulkInstallContexts(execContext, options);
  }
  
  // Classify input to determine source type (use sourceCwd for input resolution)
  const classification = await classifyPackageInput(packageInput, execContext.sourceCwd);
  
  switch (classification.type) {
    case 'registry':
      return buildRegistryInstallContext(execContext, classification.name!, options);
    
    case 'directory':
    case 'tarball':
      return buildPathInstallContext(execContext, classification.resolvedPath!, {
        ...options,
        sourceType: classification.type
      });
    
    case 'git':
      return buildGitInstallContext(execContext, classification.gitUrl!, {
        ...options,
        gitRef: classification.gitRef,
        gitPath: classification.gitPath
      });
    
    default:
      throw new Error(`Unknown package input type: ${classification.type}`);
  }
}

/**
 * Build contexts for bulk installation.
 * Returns workspace root and dependency contexts separately so the orchestrator can run workspace as a distinct stage.
 */
async function buildBulkInstallContexts(
  execContext: ExecutionContext,
  options: InstallOptions
): Promise<BulkInstallContextsResult> {
  const cwd = execContext.targetDir;
  const dependencyContexts: InstallationContext[] = [];

  // First, try to build workspace root context (run as distinct stage, not in dependency loop)
  const workspaceContext = await buildWorkspaceRootInstallContext(execContext, options, 'install');

  // Ensure workspace manifest exists before reading
  await createWorkspacePackageYml(cwd);

  // Read openpackage.yml and create context for each package
  const opkgYmlPath = getLocalPackageYmlPath(cwd);
  const opkgYml = await parsePackageYml(opkgYmlPath);

  // Get workspace package name to exclude it from bulk install
  const workspacePackageName = workspaceContext?.source.packageName;

  // Support both legacy `packages:` and current `dependencies:` + `dev-dependencies:` keys.
  const deps = ((opkgYml as any).packages ??
    (opkgYml as any).dependencies ??
    []) as any[];
  const devDeps = (((opkgYml as any).devDependencies ??
    (opkgYml as any)['dev-dependencies'] ??
    []) as any[]);

  // Merge + dedupe to avoid double-install from duplicate manifest entries
  const allDeps: any[] = [...deps, ...devDeps].filter(Boolean);
  const seen = new Set<string>();

  if (allDeps.length > 0) {
    for (const dep of allDeps) {
      const dedupeKey = JSON.stringify({
        name: dep?.name ?? null,
        url: dep?.url ?? dep?.git ?? null,
        ref: dep?.ref ?? null,
        path: dep?.path ?? null,
        version: dep?.version ?? null,
        base: dep?.base ?? null
      });
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      // Skip if this package matches the workspace package name
      if (workspacePackageName && dep.name === workspacePackageName) {
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

        // Bulk installs should match the resource-model behavior used by individual installs.
        // Many manifests use `name: gh@owner/repo/<resourcePath>` and/or `path:` to indicate a resource
        // (directory or file) within the repo. Passing that as `gitPath` breaks because gitPath implies
        // "package lives in subdirectory", and can be a file path (invalid).
        let resourcePathFromName: string | undefined;
        const depName = String(dep.name ?? '');
        if (depName.startsWith('gh@')) {
          const tail = depName.slice(3);
          const parts = tail.split('/').filter(Boolean);
          if (parts.length > 2) {
            resourcePathFromName = parts.slice(2).join('/');
          }
        }
        const effectiveResourcePath: string | undefined = dep.path || resourcePathFromName;
        const shouldTreatPathAsResource = depName.startsWith('gh@');
        
        source = {
          type: 'git',
          packageName: dep.name,
          gitUrl,
          gitRef,
          gitPath: shouldTreatPathAsResource ? undefined : dep.path,
          resourcePath: shouldTreatPathAsResource ? effectiveResourcePath : undefined,
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
        execution: execContext,
        targetDir: execContext.targetDir,
        source,
        mode: 'install',
        options,
        platforms: normalizePlatforms(options.platforms) || [],
        resolvedPackages: [],
        warnings: [],
        errors: []
      };
      
      // Phase 5: Store base from manifest for reproducibility
      // When base is present, skip base detection and use manifest value
      if (dep.base) {
        context.baseRelative = dep.base;
        context.baseSource = 'manifest';
      }
      
      dependencyContexts.push(context);
    }
  }

  return { workspaceContext: workspaceContext ?? null, dependencyContexts };
}

/**
 * Build context from a ResourceSpec (Phase 3: Resource Model)
 */
export async function buildResourceInstallContext(
  execContext: ExecutionContext,
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
      const relativePath = relative(execContext.sourceCwd, absolutePath).replace(/\\/g, '/');
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
    execution: execContext,
    targetDir: execContext.targetDir,
    source,
    mode: 'install',
    options,
    platforms: normalizePlatforms(options.platforms) || [],
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
  const detectedBase = baseContext.detectedBase ?? baseContext.source.contentRoot ?? baseContext.targetDir;
  const baseRelative = baseContext.baseRelative ?? (relative(repoRoot, detectedBase) || '.');

  return resourceSpecs.map(spec => {
    const source: PackageSource = {
      ...baseContext.source,
      resourcePath: spec.resourcePath,
      resourceVersion: spec.resourceVersion
    };

    const effectiveBase = baseContext.detectedBase ?? spec.basePath;

    return {
      ...baseContext,
      source,
      resolvedPackages: baseContext.resolvedPackages.length > 0
        ? baseContext.resolvedPackages
        : [],
      warnings: [],
      errors: [],
      detectedBase: effectiveBase,
      baseRelative: baseRelative === '' ? '.' : baseRelative,
      baseSource: baseContext.baseSource,
      matchedPattern: buildResourceMatchedPattern(spec, repoRoot, effectiveBase) ?? baseContext.matchedPattern
    };
  });
}


