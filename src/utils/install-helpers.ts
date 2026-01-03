import * as semver from 'semver';
import { PackageYml } from '../types/index.js';
import { resolveDependencies, ResolvedPackage } from '../core/dependency-resolver.js';
import { gatherRootVersionConstraints } from '../core/openpackage.js';
import { arePackageNamesEquivalent } from './package-name.js';
import { getLocalPackageYmlPath } from './paths.js';
import { parsePackageYml } from './package-yml.js';
import { exists } from './fs.js';

/**
 * Extract packages from openpackage.yml configuration
 */
export function extractPackagesFromConfig(config: PackageYml): Array<{ name: string; version?: string; path?: string; git?: string; ref?: string; isDev: boolean }> {
  const packages: Array<{ name: string; version?: string; path?: string; git?: string; ref?: string; isDev: boolean }> = [];
  
  const processSection = (section: 'packages' | 'dev-packages', isDev: boolean) => {
    const deps = config[section];
    if (deps) {
      for (const pkg of deps) {
        packages.push({
          name: pkg.name,
          version: pkg.version,
          path: pkg.path,
          git: (pkg as any).git,
          ref: (pkg as any).ref,
          isDev
        });
      }
    }
  };

  processSection('packages', false);
  processSection('dev-packages', true);
  
  return packages;
}

/**
 * Re-resolve dependencies with version overrides to ensure correct child dependencies
 */
export async function resolveDependenciesWithOverrides(
  packageName: string,
  targetDir: string,
  skippedPackages: string[],
  globalConstraints?: Map<string, string[]>,
  version?: string
): Promise<{ resolvedPackages: ResolvedPackage[]; missingPackages: string[] }> {
  // Re-gather root constraints (which now includes any newly persisted versions)
  const rootConstraints = await gatherRootVersionConstraints(targetDir);
  
  // Filter out skipped packages by creating a wrapper
  const customResolveDependencies = async (
    name: string,
    dir: string,
    isRoot: boolean = true,
    visitedStack: Set<string> = new Set(),
    resolvedPackages: Map<string, ResolvedPackage> = new Map(),
    ver?: string,
    requiredVersions: Map<string, string[]> = new Map(),
    globalConst?: Map<string, string[]>,
    rootOver?: Map<string, string[]>
  ): Promise<{ resolvedPackages: ResolvedPackage[]; missingPackages: string[] }> => {
    // Skip if this package is in the skipped list
    if (skippedPackages.includes(name)) {
      return { resolvedPackages: Array.from(resolvedPackages.values()), missingPackages: [] };
    }

    return await resolveDependencies(
      name,
      dir,
      isRoot,
      visitedStack,
      resolvedPackages,
      ver,
      requiredVersions,
      globalConst,
      rootOver
    );
  };
  
  // Re-resolve the entire dependency tree with updated root constraints
  return await customResolveDependencies(
    packageName,
    targetDir,
    true,
    new Set(),
    new Map(),
    version,
    new Map(),
    globalConstraints,
    rootConstraints
  );
}

/**
 * Get the highest version and required version of a package from the dependency tree
 */
export async function getVersionInfoFromDependencyTree(
  packageName: string,
  resolvedPackages: ResolvedPackage[]
): Promise<{ highestVersion: string; requiredVersion?: string }> {
  let highestVersion = '0.0.0';
  let highestRequiredVersion: string | undefined;
  
  // Get the requiredVersions map from the first resolved package
  const requiredVersions = (resolvedPackages[0] as any)?.requiredVersions as Map<string, string[]> | undefined;
  
  for (const resolved of resolvedPackages) {
    if (arePackageNamesEquivalent(resolved.name, packageName)) {
      if (semver.gt(resolved.version, highestVersion)) {
        highestVersion = resolved.version;
      }
    }
  }
  
  // Get the highest required version from all specified versions for this package
  if (requiredVersions && requiredVersions.has(packageName)) {
    const versions = requiredVersions.get(packageName)!;
    for (const version of versions) {
      if (!highestRequiredVersion || semver.gt(version, highestRequiredVersion)) {
        highestRequiredVersion = version;
      }
    }
  }
  
  return { highestVersion, requiredVersion: highestRequiredVersion };
}

/**
 * Check if a package name refers to an existing path/git-based dependency in openpackage.yml
 * Returns the dependency source if found, null otherwise
 */
export async function findExistingPathOrGitSource(
  cwd: string,
  packageName: string
): Promise<
  | { type: 'path'; path: string }
  | { type: 'git'; url: string; ref?: string; subdirectory?: string }
  | null
> {
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  if (!(await exists(packageYmlPath))) {
    return null;
  }

  const config = await parsePackageYml(packageYmlPath);
  const allDeps = [...(config.packages || []), ...(config['dev-packages'] || [])];
  
  const dep = allDeps.find(d => arePackageNamesEquivalent(d.name, packageName));
  if (!dep) {
    return null;
  }

  if (dep.git) {
    return { type: 'git', url: dep.git, ref: dep.ref, subdirectory: dep.subdirectory };
  }

  if (dep.path) {
    return { type: 'path', path: dep.path };
  }

  return null;
}
