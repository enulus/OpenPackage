/**
 * Subsumption Resolver
 * 
 * Detects and resolves overlapping installations between resource-scoped
 * installs (e.g., gh@user/repo/agents/agent1) and full-package installs
 * (e.g., gh@user/repo) from the same source.
 * 
 * Two scenarios:
 * 1. Resource installed first, then full package -> auto-replace resource entry
 * 2. Full package installed first, then resource -> skip (already covered)
 */

import type { PackageSource, InstallationContext } from '../unified/context.js';
import type { WorkspaceIndex, WorkspaceIndexPackage } from '../../../types/workspace-index.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../../utils/workspace-index-yml.js';
import { removePackageFromOpenpackageYml } from '../../../utils/package-management.js';
import { removeWorkspaceIndexEntry } from '../../../utils/workspace-index-ownership.js';
import { normalizePackageName } from '../../../utils/package-name.js';
import { normalizeGitUrl } from '../../../utils/git-url-parser.js';
import { logger } from '../../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type SubsumptionResult =
  | SubsumptionNone
  | SubsumptionUpgrade
  | SubsumptionAlreadyCovered;

export interface SubsumptionNone {
  type: 'none';
}

export interface SubsumptionUpgrade {
  type: 'upgrade';
  /** Resource-scoped entries that will be replaced by the full package */
  entriesToRemove: SubsumedEntry[];
}

export interface SubsumptionAlreadyCovered {
  type: 'already-covered';
  /** The full-package name that already covers this resource */
  coveringPackage: string;
}

export interface SubsumedEntry {
  /** Package name as recorded in the workspace index (e.g., gh@user/repo/agents/agent1) */
  packageName: string;
}

// ============================================================================
// Detection
// ============================================================================

/**
 * Extract the source identity (normalized git URL or package name) and the
 * resource suffix from an installation context's source and package name.
 * 
 * Returns null if the source type is not supported for subsumption.
 */
export function extractSourceIdentity(source: PackageSource): {
  /** Canonical source identifier (normalized git URL or registry name) */
  sourceKey: string;
  /** The gh@owner/repo prefix (for git) or package name (for registry/path) */
  basePackageName: string;
  /** Whether this install targets a specific resource within the package */
  isResourceScoped: boolean;
} | null {
  const normalizedName = normalizePackageName(source.packageName);

  if (source.type === 'git' && source.gitUrl) {
    const normalizedUrl = normalizeGitUrl(source.gitUrl);
    // For git sources, the "base" package name is gh@owner/repo
    // A resource-scoped install has a longer name like gh@owner/repo/agents/agent1
    const ghMatch = normalizedName.match(/^gh@([^/]+\/[^/]+)/);
    const basePackageName = ghMatch ? `gh@${ghMatch[1]}` : normalizedName;
    const isResourceScoped = Boolean(source.resourcePath) ||
      (normalizedName !== basePackageName);

    return {
      sourceKey: normalizedUrl,
      basePackageName,
      isResourceScoped
    };
  }

  if (source.type === 'path' && source.localPath) {
    // For path sources, the source key is the absolute path
    // Resource scoping is indicated by resourcePath
    const isResourceScoped = Boolean(source.resourcePath);
    return {
      sourceKey: `path:${source.localPath}`,
      basePackageName: normalizedName,
      isResourceScoped
    };
  }

  if (source.type === 'registry') {
    // Registry sources: the sourceKey is the normalized package name
    const isResourceScoped = Boolean(source.resourcePath || source.registryPath);
    return {
      sourceKey: `registry:${normalizedName}`,
      basePackageName: normalizedName,
      isResourceScoped
    };
  }

  return null;
}

/**
 * Determine if an existing workspace index entry belongs to the same source
 * as the incoming install. This matches based on:
 * - Git: normalized URL from the cached path pattern
 * - Path: absolute path prefix
 * - Registry: package name prefix
 * 
 * For git sources, two entries share a source if the workspace index `path`
 * field points into the same git cache directory (same URL hash + commit hash).
 */
function entrySameSource(
  existingName: string,
  existingEntry: WorkspaceIndexPackage,
  sourceKey: string,
  basePackageName: string,
  sourceType: PackageSource['type']
): boolean {
  const normalizedExistingName = normalizePackageName(existingName);
  const normalizedBase = normalizePackageName(basePackageName);

  if (sourceType === 'git') {
    // For git sources, check if names share the same gh@owner/repo prefix
    // e.g., gh@user/repo and gh@user/repo/agents/agent1
    if (normalizedExistingName.startsWith(normalizedBase + '/') ||
        normalizedExistingName === normalizedBase) {
      return true;
    }
    // Also check if the base name is a prefix of the existing name
    if (normalizedBase.startsWith(normalizedExistingName + '/') ||
        normalizedBase === normalizedExistingName) {
      return true;
    }
    return false;
  }

  if (sourceType === 'path') {
    // For path sources, entries from the same local directory
    return normalizedExistingName === normalizedBase ||
      normalizedExistingName.startsWith(normalizedBase + '/') ||
      normalizedBase.startsWith(normalizedExistingName + '/');
  }

  if (sourceType === 'registry') {
    return normalizedExistingName === normalizedBase ||
      normalizedExistingName.startsWith(normalizedBase + '/') ||
      normalizedBase.startsWith(normalizedExistingName + '/');
  }

  return false;
}

/**
 * Check for subsumption between the incoming install and existing entries.
 * 
 * @param source - The PackageSource for the incoming install
 * @param targetDir - The workspace target directory
 * @returns SubsumptionResult describing what action to take
 */
export async function checkSubsumption(
  source: PackageSource,
  targetDir: string
): Promise<SubsumptionResult> {
  const identity = extractSourceIdentity(source);
  if (!identity) {
    return { type: 'none' };
  }

  const { sourceKey, basePackageName, isResourceScoped } = identity;

  // Read current workspace index
  const wsRecord = await readWorkspaceIndex(targetDir);
  const packages = wsRecord.index.packages ?? {};

  if (Object.keys(packages).length === 0) {
    return { type: 'none' };
  }

  const normalizedIncoming = normalizePackageName(source.packageName);

  if (!isResourceScoped) {
    // ---------------------------------------------------------------
    // Scenario 1: Installing a FULL PACKAGE
    // Check if any resource-scoped entries from the same source exist
    // ---------------------------------------------------------------
    const entriesToRemove: SubsumedEntry[] = [];

    for (const existingName of Object.keys(packages)) {
      if (normalizePackageName(existingName) === normalizedIncoming) {
        // Same package name -- not a subsumption, just a reinstall/update
        continue;
      }

      if (entrySameSource(existingName, packages[existingName], sourceKey, basePackageName, source.type)) {
        const normalizedExisting = normalizePackageName(existingName);
        // The existing entry is resource-scoped (its name is longer than the base)
        if (normalizedExisting.startsWith(normalizedIncoming + '/')) {
          entriesToRemove.push({ packageName: existingName });
        }
      }
    }

    if (entriesToRemove.length > 0) {
      return { type: 'upgrade', entriesToRemove };
    }
  } else {
    // ---------------------------------------------------------------
    // Scenario 2: Installing a RESOURCE from a package
    // Check if the full package from the same source is already installed
    // ---------------------------------------------------------------
    for (const existingName of Object.keys(packages)) {
      if (!entrySameSource(existingName, packages[existingName], sourceKey, basePackageName, source.type)) {
        continue;
      }

      const normalizedExisting = normalizePackageName(existingName);
      // The existing entry is the full package (its name equals the base)
      // and the incoming is more specific (resource-scoped)
      if (normalizedExisting === normalizePackageName(basePackageName) &&
          normalizedIncoming.startsWith(normalizedExisting + '/')) {
        return {
          type: 'already-covered',
          coveringPackage: existingName
        };
      }
    }
  }

  return { type: 'none' };
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolve a subsumption upgrade by removing subsumed entries from both
 * the workspace manifest (openpackage.yml) and workspace index.
 * 
 * @param result - The upgrade subsumption result
 * @param targetDir - The workspace target directory
 */
export async function resolveSubsumption(
  result: SubsumptionUpgrade,
  targetDir: string
): Promise<void> {
  const wsRecord = await readWorkspaceIndex(targetDir);

  for (const entry of result.entriesToRemove) {
    // Remove from workspace manifest (openpackage.yml)
    const removed = await removePackageFromOpenpackageYml(targetDir, entry.packageName);
    if (removed) {
      logger.info(`Removed subsumed manifest entry: ${entry.packageName}`);
    }

    // Remove from workspace index
    removeWorkspaceIndexEntry(wsRecord.index, entry.packageName);
    logger.info(`Removed subsumed index entry: ${entry.packageName}`);

    console.log(`  Replacing ${entry.packageName} (subsumed by full package)`);
  }

  // Write updated workspace index
  await writeWorkspaceIndex(wsRecord);
}
