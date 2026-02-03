import path from 'path';

import { FILE_PATTERNS, DEPENDENCY_ARRAYS, DEFAULT_VERSION_CONSTRAINT, MUTABILITY, SOURCE_TYPES } from '../../constants/index.js';
import { exists } from '../../utils/fs.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { normalizePackageName } from '../../utils/package-name.js';
import { isRegistryPath } from '../../utils/source-mutability.js';
import { cloneGitToRegistry } from '../../utils/git-clone-registry.js';
import { resolveRegistryVersion } from './resolve-registry-version.js';
import { resolvePackageSource } from './resolve-package-source.js';
import type { DependencyGraphNode, ResolvedPackageSource } from './types.js';

interface PackageDependency {
  name: string;
  version?: string;
  path?: string;
  git?: string;
  url?: string;
  ref?: string;
}

async function resolveFromManifest(
  manifestDir: string,
  dep: PackageDependency
): Promise<ResolvedPackageSource> {
  const normalizedName = normalizePackageName(dep.name);

  if (dep.path) {
    const resolved = resolveDeclaredPath(dep.path, manifestDir);
    const absolutePath = path.join(resolved.absolute, path.sep);
    const mutability = isRegistryPath(absolutePath) ? MUTABILITY.IMMUTABLE : MUTABILITY.MUTABLE;
    const sourceType = isRegistryPath(absolutePath) ? SOURCE_TYPES.REGISTRY : SOURCE_TYPES.PATH;
    return {
      packageName: normalizedName,
      absolutePath,
      declaredPath: resolved.declared,
      mutability,
      version: dep.version,
      sourceType
    };
  }

  // Handle both new (url) and legacy (git) fields
  if (dep.url || dep.git) {
    const gitUrlRaw = dep.url || dep.git!;
    
    // Parse url field to extract ref if embedded
    const [gitUrl, embeddedRef] = gitUrlRaw.includes('#') 
      ? gitUrlRaw.split('#', 2)
      : [gitUrlRaw, undefined];
    
    // Use embedded ref if present, otherwise fall back to separate ref field
    const ref = embeddedRef || dep.ref;
    
    const { absolutePath, declaredPath } = await cloneGitToRegistry({
      url: gitUrl,
      ref
    });
    const mutability = isRegistryPath(absolutePath) ? MUTABILITY.IMMUTABLE : MUTABILITY.MUTABLE;
    return {
      packageName: normalizedName,
      absolutePath,
      declaredPath,
      mutability,
      version: dep.version,
      sourceType: SOURCE_TYPES.GIT
    };
  }

  const constraint = dep.version ?? DEFAULT_VERSION_CONSTRAINT;
  const registry = await resolveRegistryVersion(normalizedName, { constraint });
  return {
    packageName: normalizedName,
    absolutePath: registry.absolutePath,
    declaredPath: registry.declaredPath,
    mutability: MUTABILITY.IMMUTABLE,
    version: registry.version,
    sourceType: SOURCE_TYPES.REGISTRY,
    resolutionSource: registry.resolutionSource
  };
}

async function loadManifestDependencies(
  sourceRoot: string
): Promise<PackageDependency[]> {
  const manifestPath = path.join(sourceRoot, FILE_PATTERNS.OPENPACKAGE_YML);
  if (!(await exists(manifestPath))) {
    return [];
  }
  const manifest = await parsePackageYml(manifestPath);

  // Support both legacy (`packages`, `dev-packages`) and current (`dependencies`, `dev-dependencies`) keys.
  const deps = (manifest as any)[DEPENDENCY_ARRAYS.DEPENDENCIES] ?? (manifest as any)[DEPENDENCY_ARRAYS.PACKAGES] ?? [];
  const devDeps =
    (manifest as any)[DEPENDENCY_ARRAYS.DEV_DEPENDENCIES] ?? (manifest as any)[DEPENDENCY_ARRAYS.DEV_PACKAGES] ?? [];

  return [...(Array.isArray(deps) ? deps : []), ...(Array.isArray(devDeps) ? devDeps : [])];
}

/**
 * Build a minimal dependency graph starting from the workspace-declared package.
 * The graph resolves transitive dependencies by reading each package's manifest
 * directly (no reliance on cached index entries).
 */
export async function resolveDependencyGraph(
  workspaceRoot: string,
  rootPackageName: string
): Promise<DependencyGraphNode[]> {
  const visited = new Map<string, DependencyGraphNode>();

  async function dfs(pkgName: string): Promise<void> {
    const normalizedName = normalizePackageName(pkgName);
    if (visited.has(normalizedName)) return;

    const source = await resolvePackageSource(workspaceRoot, normalizedName);
    const manifestDir = source.absolutePath;
    const deps = await loadManifestDependencies(manifestDir);

    const dependencyNames: string[] = [];
    for (const dep of deps) {
      dependencyNames.push(normalizePackageName(dep.name));
    }

    visited.set(normalizedName, {
      name: normalizedName,
      version: source.version,
      source,
      dependencies: dependencyNames
    });

    // Resolve transitive dependencies using the manifest at the current source root
    for (const dep of deps) {
      const child = await resolveFromManifest(manifestDir, dep);
      if (!visited.has(child.packageName)) {
        // Store minimal node for child before deeper traversal
        visited.set(child.packageName, {
          name: child.packageName,
          version: child.version,
          source: child,
          dependencies: []
        });
        await dfs(child.packageName);
      }
    }
  }

  await dfs(rootPackageName);
  return Array.from(visited.values());
}
