/**
 * Cross-source manifest reading for dependency discovery.
 * Reads openpackage.yml from path, and extracts dependency declarations.
 */

import { join, dirname } from 'path';
import type { PackageYml, PackageDependency } from '../../../types/index.js';
import { loadPackageConfig } from '../../package-context.js';
import { exists } from '../../../utils/fs.js';
import { parsePackageYml } from '../../../utils/package-yml.js';
import { DIR_PATTERNS, FILE_PATTERNS } from '../../../constants/index.js';
import type { DependencyDeclaration, ParsedManifest, ResolvedSource } from './types.js';

/**
 * Resolve the path to the manifest file at a content root, if it exists.
 * Tries openpackage.yml at root, then .openpackage/openpackage.yml (workspace style).
 * Returns null if neither exists.
 */
export async function getManifestPathAtContentRoot(contentRoot: string): Promise<string | null> {
  const atRoot = join(contentRoot, FILE_PATTERNS.OPENPACKAGE_YML);
  if (await exists(atRoot)) return atRoot;
  const inOpenPackage = join(contentRoot, DIR_PATTERNS.OPENPACKAGE, FILE_PATTERNS.OPENPACKAGE_YML);
  if (await exists(inOpenPackage)) return inOpenPackage;
  return null;
}

/**
 * Read manifest from a content root directory.
 * Tries openpackage.yml at root, then .openpackage/openpackage.yml (workspace style).
 */
export async function readManifestAtPath(contentRoot: string): Promise<ParsedManifest | null> {
  const atRoot = join(contentRoot, FILE_PATTERNS.OPENPACKAGE_YML);
  if (await exists(atRoot)) {
    try {
      return await parsePackageYml(atRoot);
    } catch {
      return null;
    }
  }
  const inOpenPackage = join(contentRoot, DIR_PATTERNS.OPENPACKAGE, FILE_PATTERNS.OPENPACKAGE_YML);
  if (await exists(inOpenPackage)) {
    try {
      return await parsePackageYml(inOpenPackage);
    } catch {
      return null;
    }
  }
  return loadPackageConfig(contentRoot);
}

/**
 * Read manifest from a resolved source.
 * For path: reads from absolutePath. For git/registry: requires contentRoot (populated after load).
 */
export async function readManifestFromSource(
  source: ResolvedSource
): Promise<ParsedManifest | null> {
  const contentRoot = source.contentRoot ?? source.absolutePath;
  if (!contentRoot) {
    return null;
  }
  return readManifestAtPath(contentRoot);
}

/**
 * Convert PackageDependency from manifest to DependencyDeclaration.
 */
function toDependencyDeclaration(
  dep: PackageDependency & { base?: string },
  declaredIn: string,
  depth: number,
  isDev: boolean
): DependencyDeclaration {
  const urlRaw = dep.url ?? (dep as { git?: string }).git;
  const [url, embeddedRef] =
    typeof urlRaw === 'string' && urlRaw.includes('#') ? urlRaw.split('#', 2) : [urlRaw, undefined];
  const ref = embeddedRef ?? (dep as { ref?: string }).ref;

  return {
    name: dep.name,
    version: dep.version,
    path: dep.path,
    url: typeof url === 'string' ? url : undefined,
    ref,
    base: dep.base,
    isDev,
    declaredIn,
    depth
  };
}

/**
 * Extract dependency declarations from a parsed manifest.
 * declaredIn: path to the manifest file that contains these dependencies.
 * depth: depth in the dependency tree (used when recursing).
 * includeDev: if true, include dev-dependencies (only at root level).
 */
export function extractDependencies(
  manifest: ParsedManifest,
  declaredIn: string,
  depth: number,
  includeDev: boolean
): DependencyDeclaration[] {
  const out: DependencyDeclaration[] = [];

  const deps = manifest.dependencies ?? (manifest as { packages?: PackageDependency[] }).packages ?? [];
  for (const dep of deps) {
    if (!dep?.name) continue;
    out.push(toDependencyDeclaration(dep, declaredIn, depth, false));
  }

  if (includeDev && depth === 0) {
    const devDeps =
      manifest['dev-dependencies'] ??
      (manifest as { 'dev-packages'?: PackageDependency[] })['dev-packages'] ??
      [];
    for (const dep of devDeps) {
      if (!dep?.name) continue;
      out.push(toDependencyDeclaration(dep, declaredIn, depth, true));
    }
  }

  return out;
}

/**
 * Get the directory containing the manifest file.
 * Used as base for resolving relative path dependencies.
 */
export function getDeclaredInDir(manifestPath: string): string {
  return dirname(manifestPath);
}
