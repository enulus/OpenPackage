/**
 * @fileoverview Shared package name resolution logic used by both install and pack commands.
 * 
 * This module provides a unified way to resolve package names to file system paths by searching
 * across multiple locations with configurable priorities:
 * 
 * Search Locations (in order):
 * 1. CWD (current working directory) - if checkCwd=true
 * 2. Workspace packages (.openpackage/packages/) - if searchWorkspace=true
 * 3. Global packages (~/.openpackage/packages/) - if searchGlobal=true
 * 4. Local registry (~/.openpackage/registry/) - if searchRegistry=true
 * 
 * Priority Rules:
 * - CWD always wins if name matches and checkCwd=true (pack behavior)
 * - Workspace always wins among remaining sources (both install and pack)
 * - Between global and registry: highest version wins
 * - Tie-breaker: prefer global (mutable) over registry (immutable) on same version
 * 
 * Usage Examples:
 * 
 * ```typescript
 * // Pack command - prioritize CWD, skip registry (already immutable)
 * const packResult = await resolvePackageByName({
 *   cwd: process.cwd(),
 *   packageName: 'my-package',
 *   checkCwd: true,        // Check CWD first (highest priority)
 *   searchWorkspace: true, // Then workspace packages
 *   searchGlobal: true,    // Then global packages
 *   searchRegistry: false  // Skip registry (already packed)
 * });
 * 
 * // Install command - search all sources including registry
 * const installResult = await resolvePackageByName({
 *   cwd: process.cwd(),
 *   packageName: 'my-package',
 *   checkCwd: false,       // Don't prioritize CWD
 *   searchWorkspace: true, // Check workspace packages
 *   searchGlobal: true,    // Check global packages
 *   searchRegistry: true   // Check registry (install needs this)
 * });
 * ```
 */

import { join } from 'path';
import * as semver from 'semver';

import { DIR_PATTERNS, OPENPACKAGE_DIRS, UNVERSIONED } from '../constants/index.js';
import { isValidPackageDirectory, loadPackageConfig } from '../core/package-context.js';
import { getOpenPackageDirectories, listPackageVersions, getPackageVersionPath } from '../core/directory.js';
import { normalizePackageName, SCOPED_PACKAGE_REGEX } from './package-name.js';
import { logger } from './logger.js';

/**
 * Types of package sources that can be resolved
 */
export type PackageSourceType = 'cwd' | 'workspace' | 'global' | 'registry';

/**
 * A candidate package source found during resolution
 */
export interface PackageSourceCandidate {
  path: string;
  version: string;
  type: PackageSourceType;
  packageName: string;
}

/**
 * Information about how a package was resolved from multiple candidates
 */
export interface SourceResolutionInfo {
  candidates: PackageSourceCandidate[];
  selected: PackageSourceCandidate;
  reason: 'only-source' | 'newer-version' | 'same-version-prefer-mutable' | 'cwd-match' | 'workspace-override';
}

/**
 * Result of package name resolution
 */
export interface PackageNameResolutionResult {
  found: boolean;
  path?: string;
  version?: string;
  sourceType?: PackageSourceType;
  resolutionInfo?: SourceResolutionInfo;
}

/**
 * Options for controlling package name resolution behavior
 */
export interface PackageNameResolutionOptions {
  /** Current working directory */
  cwd: string;
  /** Package name to resolve */
  packageName: string;
  /** Check if CWD is the package (highest priority for pack) */
  checkCwd?: boolean;
  /** Search workspace packages (.openpackage/packages/) */
  searchWorkspace?: boolean;
  /** Search global packages (~/.openpackage/packages/) */
  searchGlobal?: boolean;
  /** Search local registry (~/.openpackage/registry/) */
  searchRegistry?: boolean;
}

/**
 * Helper to construct scoped package paths (@scope/name)
 */
function getScopedPackagePath(baseDir: string, packageName: string): string {
  const scopedMatch = packageName.match(SCOPED_PACKAGE_REGEX);
  if (scopedMatch) {
    const [, scope, localName] = scopedMatch;
    return join(baseDir, '@' + scope, localName);
  }
  return join(baseDir, packageName);
}

/**
 * Check if CWD is a valid package directory with matching name
 */
async function checkCwdPackage(
  cwd: string,
  packageName: string
): Promise<PackageSourceCandidate | null> {
  if (!await isValidPackageDirectory(cwd)) {
    return null;
  }

  const manifest = await loadPackageConfig(cwd);
  if (!manifest) {
    return null;
  }

  // Check if name matches (case-insensitive)
  const normalizedCwdName = normalizePackageName(manifest.name);
  const normalizedTargetName = normalizePackageName(packageName);
  
  if (normalizedCwdName !== normalizedTargetName) {
    return null;
  }

  logger.debug('Found package in CWD', { packageName, path: cwd, version: manifest.version });
  
  return {
    path: cwd,
    version: manifest.version || UNVERSIONED,
    type: 'cwd',
    packageName: normalizedCwdName
  };
}

/**
 * Check workspace packages directory
 */
async function checkWorkspacePackage(
  cwd: string,
  packageName: string
): Promise<PackageSourceCandidate | null> {
  const normalizedName = normalizePackageName(packageName);
  const localPath = getScopedPackagePath(
    join(cwd, DIR_PATTERNS.OPENPACKAGE, OPENPACKAGE_DIRS.PACKAGES),
    normalizedName
  );

  if (!await isValidPackageDirectory(localPath)) {
    return null;
  }

  const manifest = await loadPackageConfig(localPath);
  logger.debug('Found package in workspace', { packageName, path: localPath, version: manifest?.version });

  return {
    path: localPath,
    version: manifest?.version || UNVERSIONED,
    type: 'workspace',
    packageName: normalizedName
  };
}

/**
 * Check global packages directory
 */
async function checkGlobalPackage(
  packageName: string
): Promise<PackageSourceCandidate | null> {
  const normalizedName = normalizePackageName(packageName);
  const dirs = getOpenPackageDirectories();
  const globalPath = getScopedPackagePath(
    join(dirs.data, OPENPACKAGE_DIRS.PACKAGES),
    normalizedName
  );

  if (!await isValidPackageDirectory(globalPath)) {
    return null;
  }

  try {
    const manifest = await loadPackageConfig(globalPath);
    logger.debug('Found package in global packages', { 
      packageName, 
      path: globalPath,
      version: manifest?.version 
    });

    return {
      path: globalPath,
      version: manifest?.version || UNVERSIONED,
      type: 'global',
      packageName: normalizedName
    };
  } catch (error) {
    logger.warn('Failed to load global package manifest', { packageName, path: globalPath, error });
    return null;
  }
}

/**
 * Check local registry (get latest version)
 */
async function checkRegistryPackage(
  packageName: string
): Promise<PackageSourceCandidate | null> {
  const normalizedName = normalizePackageName(packageName);
  
  try {
    const registryVersions = await listPackageVersions(normalizedName);
    if (registryVersions.length === 0) {
      return null;
    }

    const latestVersion = registryVersions[0]; // Already sorted desc
    const registryPath = getPackageVersionPath(normalizedName, latestVersion);
    
    logger.debug('Found package in registry', { 
      packageName, 
      path: registryPath,
      version: latestVersion 
    });

    return {
      path: registryPath,
      version: latestVersion,
      type: 'registry',
      packageName: normalizedName
    };
  } catch (error) {
    logger.debug('No registry versions found', { packageName });
    return null;
  }
}

/**
 * Select the best candidate from multiple package sources
 * Priority rules:
 * 1. CWD always wins (if checked and found)
 * 2. Workspace always wins (among non-CWD)
 * 3. Highest version between global and registry
 * 4. Tie-breaker: prefer global (mutable) over registry (immutable)
 */
function selectBestCandidate(candidates: PackageSourceCandidate[]): PackageSourceCandidate {
  if (candidates.length === 0) {
    throw new Error('selectBestCandidate called with empty candidates array');
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  // CWD always wins if present
  const cwdCandidate = candidates.find(c => c.type === 'cwd');
  if (cwdCandidate) {
    return cwdCandidate;
  }

  // Workspace always wins (among non-CWD)
  const workspaceCandidate = candidates.find(c => c.type === 'workspace');
  if (workspaceCandidate) {
    return workspaceCandidate;
  }

  // Now we only have global and/or registry candidates
  // Handle unversioned packages
  const hasUnversioned = candidates.some(c => c.version === UNVERSIONED);
  if (hasUnversioned) {
    // Prefer versioned over unversioned
    const versioned = candidates.filter(c => c.version !== UNVERSIONED);
    if (versioned.length > 0) {
      // Return highest versioned
      versioned.sort((a, b) => semver.compare(b.version, a.version));
      return versioned[0];
    }
    // All unversioned - prefer global
    const global = candidates.find(c => c.type === 'global');
    return global || candidates[0];
  }

  // Sort by version (highest first), prefer global on tie
  const sorted = [...candidates].sort((a, b) => {
    const versionCompare = semver.compare(b.version, a.version);
    if (versionCompare !== 0) return versionCompare;

    // Tie-breaker: same version, prefer global (mutable)
    if (a.type === 'global' && b.type === 'registry') return -1;
    if (a.type === 'registry' && b.type === 'global') return 1;
    return 0;
  });

  return sorted[0];
}

/**
 * Determine the reason why a particular candidate was selected
 */
function determineSelectionReason(
  candidates: PackageSourceCandidate[],
  selected: PackageSourceCandidate
): SourceResolutionInfo['reason'] {
  if (candidates.length === 1) {
    return 'only-source';
  }

  if (selected.type === 'cwd') {
    return 'cwd-match';
  }

  if (selected.type === 'workspace') {
    return 'workspace-override';
  }

  // Compare with other candidates (global vs registry)
  const other = candidates.find(c => c !== selected && c.type !== 'workspace' && c.type !== 'cwd');
  if (!other) {
    return 'only-source';
  }

  // Handle unversioned comparisons
  if (selected.version === UNVERSIONED || other.version === UNVERSIONED) {
    return 'newer-version';
  }

  const versionCompare = semver.compare(selected.version, other.version);

  if (versionCompare > 0) {
    return 'newer-version';
  } else if (versionCompare === 0) {
    return 'same-version-prefer-mutable';
  }

  // Shouldn't reach here since we select highest
  return 'newer-version';
}

/**
 * Resolve a package name to a file system path.
 * 
 * This function searches for packages in various locations based on the provided options:
 * - CWD (current working directory) - if checkCwd is true
 * - Workspace packages (.openpackage/packages/)
 * - Global packages (~/.openpackage/packages/)
 * - Local registry (~/.openpackage/registry/)
 * 
 * Priority order:
 * 1. CWD (if name matches and checkCwd=true) - highest priority for pack
 * 2. Workspace packages - always wins among remaining sources
 * 3. Global vs Registry - version comparison, prefer higher version
 * 4. Tie-breaker - same version prefers global (mutable)
 * 
 * @param options - Resolution options
 * @returns Resolution result with path and metadata
 */
export async function resolvePackageByName(
  options: PackageNameResolutionOptions
): Promise<PackageNameResolutionResult> {
  const {
    cwd,
    packageName,
    checkCwd = false,
    searchWorkspace = true,
    searchGlobal = true,
    searchRegistry = true
  } = options;

  const candidates: PackageSourceCandidate[] = [];

  // 1. Check CWD (highest priority for pack)
  if (checkCwd) {
    const cwdCandidate = await checkCwdPackage(cwd, packageName);
    if (cwdCandidate) {
      candidates.push(cwdCandidate);
    }
  }

  // 2. Check workspace packages
  if (searchWorkspace) {
    const workspaceCandidate = await checkWorkspacePackage(cwd, packageName);
    if (workspaceCandidate) {
      candidates.push(workspaceCandidate);
    }
  }

  // 3. Check global packages
  if (searchGlobal) {
    const globalCandidate = await checkGlobalPackage(packageName);
    if (globalCandidate) {
      candidates.push(globalCandidate);
    }
  }

  // 4. Check local registry
  if (searchRegistry) {
    const registryCandidate = await checkRegistryPackage(packageName);
    if (registryCandidate) {
      candidates.push(registryCandidate);
    }
  }

  // No candidates found
  if (candidates.length === 0) {
    logger.debug('No package found in any location', { packageName, options });
    return { found: false };
  }

  // Select best candidate
  const selected = selectBestCandidate(candidates);
  const reason = determineSelectionReason(candidates, selected);

  logger.info('Resolved package name', {
    packageName,
    selected: {
      type: selected.type,
      version: selected.version,
      path: selected.path
    },
    candidateCount: candidates.length,
    reason
  });

  return {
    found: true,
    path: selected.path,
    version: selected.version,
    sourceType: selected.type,
    resolutionInfo: {
      candidates,
      selected,
      reason
    }
  };
}
