import * as semver from 'semver';
import { PackageYml } from '../types/index.js';
import type { ResolvedPackage } from '../core/dependency-resolver/types.js';
import { arePackageNamesEquivalent } from './package-name.js';
import { getLocalPackageYmlPath } from './paths.js';
import { parsePackageYml } from './package-yml.js';
import { exists } from './fs.js';

/**
 * Extract packages from openpackage.yml configuration
 */
export function extractPackagesFromConfig(config: PackageYml): Array<{ name: string; version?: string; path?: string; git?: string; url?: string; ref?: string; subdirectory?: string; isDev: boolean }> {
  const packages: Array<{ name: string; version?: string; path?: string; git?: string; url?: string; ref?: string; subdirectory?: string; isDev: boolean }> = [];
  
  const processSection = (section: 'dependencies' | 'dev-dependencies', isDev: boolean) => {
    const deps = config[section];
    if (deps) {
      for (const pkg of deps) {
        packages.push({
          name: pkg.name,
          version: pkg.version,
          path: pkg.path,
          git: (pkg as any).git,
          url: (pkg as any).url,
          ref: (pkg as any).ref,
          subdirectory: (pkg as any).subdirectory,
          isDev
        });
      }
    }
  };

  processSection('dependencies', false);
  processSection('dev-dependencies', true);
  
  return packages;
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
  | { type: 'git'; url: string; ref?: string; subdir?: string }
  | null
> {
  const packageYmlPath = getLocalPackageYmlPath(cwd);
  if (!(await exists(packageYmlPath))) {
    return null;
  }

  const config = await parsePackageYml(packageYmlPath);
  const allDeps = [...(config.dependencies || []), ...(config['dev-dependencies'] || [])];
  
  const dep = allDeps.find(d => arePackageNamesEquivalent(d.name, packageName));
  if (!dep) {
    return null;
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
    
    return { type: 'git', url: gitUrl, ref, subdir: dep.path };
  }

  if (dep.path) {
    return { type: 'path', path: dep.path };
  }

  return null;
}
