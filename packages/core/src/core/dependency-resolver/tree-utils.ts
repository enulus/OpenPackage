import type { DependencyNode } from './types.js';
import { scanOpenPackagePackages } from '../openpackage.js';
import { formatVersionLabel } from '../../utils/package-versioning.js';
import { logger } from '../../utils/logger.js';

/**
 * Build dependency tree for all packages in openpackage (used by uninstall)
 */
export async function buildDependencyTree(openpackagePath: string, protectedPackages: Set<string>): Promise<Map<string, DependencyNode>> {
  const dependencyTree = new Map<string, DependencyNode>();
  
  // Use the shared scanOpenPackagePackages function
  const packages = await scanOpenPackagePackages(openpackagePath);
  
  // First pass: collect all packages and their dependencies
  for (const [packageName, pkg] of packages) {
    const dependencies = new Set<string>();
    
    // Collect dependencies from both dependencies and dev-dependencies
    const allDeps = [
      ...(pkg.dependencies || []),
      ...(pkg['dev-dependencies'] || [])
    ];
    
    for (const dep of allDeps) {
      dependencies.add(dep.name);
    }
    
    dependencyTree.set(packageName, {
      name: packageName,
      version: formatVersionLabel(pkg.version),
      dependencies,
      dependents: new Set(),
      isProtected: protectedPackages.has(packageName)
    });
  }
  
  // Second pass: build dependents relationships
  for (const [packageName, node] of dependencyTree) {
    for (const depName of node.dependencies) {
      const depNode = dependencyTree.get(depName);
      if (depNode) {
        depNode.dependents.add(packageName);
      }
    }
  }
  
  return dependencyTree;
}

/**
 * Get all dependencies of a package recursively
 */
export async function getAllDependencies(packageName: string, dependencyTree: Map<string, DependencyNode>, visited: Set<string> = new Set()): Promise<Set<string>> {
  const allDeps = new Set<string>();
  
  if (visited.has(packageName)) {
    return allDeps; // Prevent infinite recursion
  }
  
  visited.add(packageName);
  const node = dependencyTree.get(packageName);
  
  if (node) {
    for (const dep of node.dependencies) {
      allDeps.add(dep);
      const subDeps = await getAllDependencies(dep, dependencyTree, visited);
      for (const subDep of subDeps) {
        allDeps.add(subDep);
      }
    }
  }
  
  visited.delete(packageName);
  return allDeps;
}

/**
 * Find dangling dependencies that can be safely removed (used by uninstall)
 */
export async function findDanglingDependencies(
  targetPackage: string,
  dependencyTree: Map<string, DependencyNode>
): Promise<Set<string>> {
  const danglingDeps = new Set<string>();
  
  // Get all dependencies of the target package
  const allDependencies = await getAllDependencies(targetPackage, dependencyTree);
  
  // Check each dependency to see if it's dangling
  for (const depName of allDependencies) {
    const depNode = dependencyTree.get(depName);
    if (!depNode) continue;
    
    // Skip if protected (listed in cwd openpackage.yml)
    if (depNode.isProtected) {
      logger.debug(`Skipping protected package: ${depName}`);
      continue;
    }
    
    // Check if this dependency has any dependents outside the dependency tree being removed
    let hasExternalDependents = false;
    for (const dependent of depNode.dependents) {
      // If the dependent is not the target package and not in the dependency tree, it's external
      if (dependent !== targetPackage && !allDependencies.has(dependent)) {
        hasExternalDependents = true;
        break;
      }
    }
    
    // If no external dependents, it's dangling
    if (!hasExternalDependents) {
      danglingDeps.add(depName);
    }
  }
  
  return danglingDeps;
}
