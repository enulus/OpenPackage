import path from 'path';

import { parsePackageYml } from '../../utils/package-yml.js';
import { getLocalPackageYmlPath } from '../../utils/paths.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { arePackageNamesEquivalent, normalizePackageName } from '../../utils/package-name.js';
import { isRegistryPath } from '../../utils/source-mutability.js';
import { exists } from '../../utils/fs.js';
import { cloneGitToRegistry } from '../../utils/git-clone-registry.js';
import { resolveRegistryVersion } from './resolve-registry-version.js';
import { DEPENDENCY_ARRAYS, DEFAULT_VERSION_CONSTRAINT, MUTABILITY, SOURCE_TYPES } from '../../constants/index.js';
import type { ResolvedPackageSource } from './types.js';

interface PackageDependency {
  name: string;
  version?: string;
  path?: string;
  git?: string;
  ref?: string;
}

interface ResolvePackageSourceOptions {
  /**
   * If true, include dev-packages when searching for the dependency (default: true).
   */
  includeDev?: boolean;
}

function findDependencyEntry(
  deps: PackageDependency[] | undefined,
  target: string
): PackageDependency | null {
  if (!deps) return null;
  const normalized = normalizePackageName(target);
  return deps.find(dep => arePackageNamesEquivalent(dep.name, normalized)) ?? null;
}

export async function resolvePackageSource(
  workspaceRoot: string,
  packageName: string,
  options: ResolvePackageSourceOptions = {}
): Promise<ResolvedPackageSource> {
  const manifestPath = getLocalPackageYmlPath(workspaceRoot);
  const manifestDir = path.dirname(manifestPath);
  const config = await parsePackageYml(manifestPath);

  const includeDev = options.includeDev ?? true;
  const candidates: PackageDependency[] = [
    ...(config[DEPENDENCY_ARRAYS.PACKAGES] || []),
    ...(includeDev ? config[DEPENDENCY_ARRAYS.DEV_PACKAGES] || [] : [])
  ];

  const dep = findDependencyEntry(candidates, packageName);
  if (!dep) {
    throw new Error(
      `Package '${packageName}' is not declared in .openpackage/openpackage.yml (packages or dev-packages).`
    );
  }

  const normalizedName = normalizePackageName(dep.name);

  // 1) Path-based dependency
  if (dep.path) {
    const resolved = resolveDeclaredPath(dep.path, manifestDir);
    const absolutePath = path.join(resolved.absolute, path.sep);
    if (!(await exists(absolutePath))) {
      throw new Error(`Declared path for '${normalizedName}' does not exist: ${resolved.declared}`);
    }
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

  // 2) Git dependency
  if (dep.git) {
    const { absolutePath, declaredPath } = await cloneGitToRegistry({
      url: dep.git,
      ref: dep.ref
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

  // 3) Registry dependency (version-based)
  const constraint = dep.version ?? DEFAULT_VERSION_CONSTRAINT;
  const registry = await resolveRegistryVersion(normalizedName, { constraint });
  const mutability = MUTABILITY.IMMUTABLE;

  return {
    packageName: normalizedName,
    absolutePath: registry.absolutePath,
    declaredPath: registry.declaredPath,
    mutability,
    version: registry.version,
    sourceType: SOURCE_TYPES.REGISTRY,
    resolutionSource: registry.resolutionSource
  };
}
