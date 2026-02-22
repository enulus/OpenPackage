/**
 * @fileoverview Resolves mutable package sources for add/edit operations.
 * 
 * Unlike resolve-package-source.ts (which requires packages to be in the workspace index),
 * this module finds mutable packages across workspace and global directories without
 * requiring prior installation in the current workspace.
 * 
 * Usage:
 * - `add` command: Add files to any mutable package regardless of workspace installation
 * - Future editing commands: Modify package sources directly
 */

import path from 'path';

import { resolvePackageByName, type PackageSourceType } from '../../utils/package-name-resolution.js';
import { isRegistryPath } from '../../utils/source-mutability.js';
import { MUTABILITY, SOURCE_TYPES, type SourceType } from '../../constants/index.js';
import { normalizePackageNameForLookup } from '../../utils/package-name.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import type { ResolvedPackageSource } from './types.js';

export interface ResolveMutableSourceOptions {
  /** Current working directory */
  cwd: string;
  /** Package name to resolve */
  packageName: string;
}

/**
 * Resolves a mutable package source from workspace or global packages.
 * 
 * This function searches for packages in:
 * - Workspace packages (.openpackage/packages/)
 * - Global packages (~/.openpackage/packages/)
 * 
 * Registry packages are excluded as they are immutable by design.
 * 
 * @throws Error if package is not found or is immutable (registry)
 */
export async function resolveMutableSource(
  options: ResolveMutableSourceOptions
): Promise<ResolvedPackageSource> {
  const { cwd, packageName } = options;
  // Use lookup normalization for backward compatibility with old format
  const normalizedName = normalizePackageNameForLookup(packageName);

  // Search workspace and global packages only (exclude registry)
  const resolution = await resolvePackageByName({
    cwd,
    packageName: normalizedName,
    checkCwd: false,
    searchWorkspace: true,
    searchGlobal: true,
    searchRegistry: false // Exclude registry (immutable)
  });

  if (!resolution.found || !resolution.path) {
    throw new Error(
      `Package '${packageName}' not found in workspace or global packages.\n` +
      `Available locations:\n` +
      `  - Workspace packages: ${path.join(cwd, '.openpackage', 'packages')}/\n` +
      `  - Global packages: ~/.openpackage/packages/\n\n` +
      `Registry packages are immutable and cannot be modified directly.\n` +
      `To edit a registry package:\n` +
      `  1. Install it with a mutable source: opkg install git:<repo-url> or opkg install path:<local-path>\n` +
      `  2. Or create a workspace/global package copy`
    );
  }

  // Double-check mutability (shouldn't happen given our search params, but defensive)
  const absolutePath = path.join(resolution.path, path.sep);
  if (isRegistryPath(absolutePath)) {
    throw new Error(
      `Package '${packageName}' resolves to a registry path, which is immutable.\n` +
      `Registry packages cannot be modified via add command.\n` +
      `Path: ${resolution.path}`
    );
  }

  // Load package metadata
  const packageYmlPath = path.join(absolutePath, FILE_PATTERNS.OPENPACKAGE_YML);
  const config = await parsePackageYml(packageYmlPath);

  // Map source type from resolution
  const sourceType = mapSourceType(resolution.sourceType);

  // Construct declared path (for potential future index updates)
  const declaredPath = constructDeclaredPath(absolutePath, resolution.sourceType);

  return {
    packageName: normalizedName,
    absolutePath,
    declaredPath,
    mutability: MUTABILITY.MUTABLE,
    version: config.version,
    sourceType
  };
}

/**
 * Maps package resolution source type to internal SourceType
 */
function mapSourceType(sourceType: PackageSourceType | undefined): SourceType {
  switch (sourceType) {
    case 'workspace':
    case 'global':
    case 'cwd':
      return SOURCE_TYPES.PATH;
    default:
      return SOURCE_TYPES.PATH;
  }
}

/**
 * Constructs the declared path for a package source.
 * Uses relative paths for workspace packages, tilde notation for global.
 */
function constructDeclaredPath(absolutePath: string, sourceType: PackageSourceType | undefined): string {
  if (sourceType === 'workspace') {
    // Workspace packages: use relative path from cwd
    const cwd = process.cwd();
    const relativePath = path.relative(cwd, absolutePath);
    return `./${relativePath}`;
  } else if (sourceType === 'global') {
    // Global packages: use tilde notation
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (absolutePath.startsWith(home)) {
      return absolutePath.replace(home, '~');
    }
  }
  
  // Fallback: absolute path
  return absolutePath;
}
