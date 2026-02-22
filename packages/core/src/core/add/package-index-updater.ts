import { dirname, join } from 'path';
import { FILE_PATTERNS, PACKAGE_ROOT_DIRS } from '../../constants/index.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import {
  getPackageIndexPath,
  readPackageIndex,
  writePackageIndex,
  type PackageIndexRecord,
  sortMapping,
  pruneNestedDirectories
} from '../../utils/package-index-yml.js';
import {
  buildIndexMappingForPackageFiles,
  loadOtherPackageIndexes
} from '../../utils/index-based-installer.js';
import { UNVERSIONED } from '../../constants/index.js';
import type { PackageFile } from '../../types/index.js';
import type { PackageContext } from '../package-context.js';
import { parseUniversalPath } from '../../utils/platform-file.js';
import { mapUniversalToPlatform } from '../../utils/platform-mapper.js';
import { getPlatformsState, isPlatformId, type Platform } from '../platforms.js';
import {
  normalizeRegistryPath,
  isRootRegistryPath,
  isSkippableRegistryPath,
  isAllowedRegistryPath
} from '../../utils/registry-entry-filter.js';
import { createWorkspaceHash } from '../../utils/version-generator.js';
import { getPlatformRootFileNames, stripRootCopyPrefix, isRootCopyPath } from '../../utils/platform-root-files.js';

/**
 * Compute the directory key (registry side) to collapse file mappings under.
 * Mirrors the grouping behavior used by install/index mapping logic.
 */
export function computeDirKeyFromRegistryPath(registryPath: string, cwd?: string): string {
  const normalized = registryPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/');
  if (parts.length <= 1) return '';
  
  // Use dynamically discovered universal subdirs instead of hardcoded list
  const state = getPlatformsState(cwd ?? null);
  const universalSubdirs = state.universalSubdirs;
  if (universalSubdirs.has(parts[0])) {
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}/`;
    return `${parts[0]}/`;
  }
  
  const idx = normalized.lastIndexOf('/');
  if (idx === -1) return '';
  return normalized.substring(0, idx + 1);
}

/**
 * Prune stale keys from previous index that no longer exist in current files.
 * File keys are kept only if the exact file path exists in currentFiles.
 * Directory keys are kept only if at least one current file path starts with that directory prefix.
 */
function pruneStaleKeysByCurrentFiles(
  previous: Record<string, string[]>,
  currentFiles: string[]
): Record<string, string[]> {
  // Normalize to forward slashes for consistent comparisons
  const normalizedCurrent = currentFiles.map(p => p.replace(/\\/g, '/'));
  const currentSet = new Set(normalizedCurrent);

  const result: Record<string, string[]> = {};
  for (const [rawKey, values] of Object.entries(previous)) {
    const key = rawKey.replace(/\\/g, '/');

    if (key.endsWith('/')) {
      // Keep dir keys only if at least one current file is under that directory
      if (normalizedCurrent.some(p => p.startsWith(key))) {
        result[key] = values;
      }
    } else {
      // Keep file keys only if that exact file still exists
      if (currentSet.has(key)) {
        result[key] = values;
      }
    }
  }
  return result;
}

/**
 * Merge new mapping updates with existing index.
 * 
 * @param previous - Previous index mapping
 * @param updates - New mapping updates
 * @param replaceExact - When true, replace values entirely for exact file keys instead of merging.
 *                       This ensures the index reflects current state, not accumulated history.
 */
function mergeMappingsRespectingExisting(
  previous: Record<string, string[]>,
  updates: Record<string, string[]>,
  replaceExact: boolean = false
): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...previous };

  for (const [key, newVals] of Object.entries(updates)) {
    // For exact file keys (not directory keys), replace values when replaceExact is true
    // This prevents stale paths from being preserved when files are re-indexed
    if (replaceExact && !key.endsWith('/')) {
      merged[key] = newVals.sort();
      continue;
    }

    const prevVals = merged[key] || [];
    // Union + de-dupe
    const union = Array.from(new Set([...prevVals, ...newVals]));

    // For directory keys, prune nested child dirs if parent is present
    if (key.endsWith('/')) {
      merged[key] = pruneNestedDirectories(union).sort();
    } else {
      merged[key] = union.sort();
    }
  }

  return sortMapping(merged);
}

/**
 * Build mapping from PackageFile[] and write/merge to package index file.
 */
export interface BuildIndexOptions {
  /**
   * When true, do not collapse file entries into directory keys.
   * Keeps exact file paths as keys in the package index file.
   */
  preserveExactPaths?: boolean;
  /**
   * Force the version written to the package index file (defaults to previous/index/openpackage.yml resolution).
   */
  versionOverride?: string;
}

/**
 * Build a mapping that preserves exact file keys for the provided packageFiles.
 * For universal subdirs, maps to platform-specific installed paths that ACTUALLY EXIST.
 * For platform-specific paths (with .platform suffix), only maps to that specific platform.
 * For ai/ paths and other non-universal paths, keeps the value as the same path.
 * 
 * Only includes workspace paths where the file actually exists - this ensures the index
 * reflects reality rather than hypothetical future installations. Sync operations will
 * expand the index as files are actually created.
 * 
 * Filters files using the same logic as install/save: excludes root files, skippable paths,
 * and non-allowed registry paths to match the index building behavior.
 * 
 * Prunes redundant mappings: if platform-specific keys exist (e.g., setup.claude.md),
 * their target files are excluded from the universal key (e.g., setup.md) to avoid duplication.
 */
async function buildExactFileMapping(
  cwd: string,
  packageFiles: PackageFile[],
  platforms: Platform[]
): Promise<Record<string, string[]>> {
  const mapping: Record<string, string[]> = {};

  // Collect platform-specific targets per base universal key (e.g., commands/nestjs/setup.md)
  // so we can prune duplicates from the universal key later.
  const platformSpecificTargetsByBase = new Map<string, Set<string>>();

  const addTargets = (key: string, values: Set<string>) => {
    if (values.size > 0) {
      mapping[key] = Array.from(values).sort();
    }
  };

  // Helper to check if a workspace path exists
  const checkExists = async (relPath: string): Promise<boolean> => {
    const absPath = join(cwd, relPath);
    return await exists(absPath);
  };

  const rootFileNames = getPlatformRootFileNames(platforms, cwd);

  const explicitRootKeys = new Set<string>();
  const hasAgents = packageFiles.some(file => normalizeRegistryPath(file.path) === FILE_PATTERNS.AGENTS_MD);

  // First pass: record platform-specific target files keyed by base universal key
  for (const file of packageFiles) {
    const normalized = normalizeRegistryPath(file.path);
    if (isRootCopyPath(normalized)) continue;
    if (isRootRegistryPath(normalized) || rootFileNames.has(normalized)) continue;
    if (isSkippableRegistryPath(normalized, cwd)) continue;
    if (!isAllowedRegistryPath(normalized, cwd)) continue;

    const parsed = parseUniversalPath(normalized);
    if (parsed && parsed.platformSuffix && isPlatformId(parsed.platformSuffix)) {
      try {
        const { relFile } = mapUniversalToPlatform(
          parsed.platformSuffix,
          parsed.universalSubdir as any,
          parsed.relPath,
          cwd
        );
        const baseKey = `${parsed.universalSubdir}/${parsed.relPath}`;
        const set = platformSpecificTargetsByBase.get(baseKey) ?? new Set<string>();
        set.add(relFile.replace(/\\/g, '/'));
        platformSpecificTargetsByBase.set(baseKey, set);
      } catch {
        // Ignore unsupported subdir/platform combinations
      }
    }
  }

  // Second pass: build exact mappings, only including paths that actually exist
  for (const file of packageFiles) {
    const normalized = normalizeRegistryPath(file.path);
    if (isSkippableRegistryPath(normalized, cwd)) continue;

    const key = normalized.replace(/\\/g, '/');
    const values = new Set<string>();

    // Copy-to-root: root/** → strip prefix in workspace
    const stripped = stripRootCopyPrefix(key);
    if (stripped !== null) {
      if (await checkExists(stripped)) {
        values.add(stripped);
      }
      addTargets(key, values);
      continue;
    }

    // Root files: store at workspace root with same name; AGENTS.md may also populate platform root files
    if (rootFileNames.has(key) || isRootRegistryPath(key)) {
      explicitRootKeys.add(key);
      if (await checkExists(key)) {
        values.add(key);
      }
      addTargets(key, values);
      continue;
    }

    if (!isAllowedRegistryPath(normalized, cwd)) continue;

    const parsed = parseUniversalPath(key);
    if (parsed) {
      if (parsed.platformSuffix && isPlatformId(parsed.platformSuffix)) {
        // Platform-specific registry key → only that platform target if it exists
        try {
          const { relFile } = mapUniversalToPlatform(
            parsed.platformSuffix,
            parsed.universalSubdir as any,
            parsed.relPath,
            cwd
          );
          const relPath = relFile.replace(/\\/g, '/');
          if (await checkExists(relPath)) {
            values.add(relPath);
          }
        } catch {
          // Ignore unsupported subdir/platform combinations
        }
      } else {
        // Universal registry key → only include platform paths that actually exist
        for (const platform of platforms) {
          try {
            const { relFile } = mapUniversalToPlatform(platform, parsed.universalSubdir as any, parsed.relPath, cwd);
            const relPath = relFile.replace(/\\/g, '/');
            if (await checkExists(relPath)) {
              values.add(relPath);
            }
          } catch {
            // Ignore unsupported platforms
          }
        }
        // Also record the workspace-relative key itself when it exists.
        // This is important for root packages (and add flows) where the source path may be the only
        // concrete workspace location before any apply/install expansion.
        if (await checkExists(key)) {
          values.add(key);
        }
        // Prune: if platform-specific keys exist for this base, remove their targets from universal
        const baseKey = `${parsed.universalSubdir}/${parsed.relPath}`;
        const covered = platformSpecificTargetsByBase.get(baseKey);
        if (covered && covered.size > 0) {
          for (const target of covered) {
            values.delete(target);
          }
        }
      }
    } else {
      // Fallback: keep value as the same path if it exists
      if (await checkExists(key)) {
        values.add(key);
      }
    }

    addTargets(key, values);
  }

  // If AGENTS.md exists in the package and platform root files exist in the workspace (without explicit overrides),
  // record them as installed paths for AGENTS.md.
  if (hasAgents) {
    const values = new Set<string>(mapping[FILE_PATTERNS.AGENTS_MD] ?? []);
    for (const rootFile of rootFileNames) {
      if (rootFile === FILE_PATTERNS.AGENTS_MD) continue;
      if (explicitRootKeys.has(rootFile)) continue;
      if (await checkExists(rootFile)) {
        values.add(rootFile);
      }
    }
    addTargets(FILE_PATTERNS.AGENTS_MD, values);
  }

  return mapping;
}

export async function buildMappingAndWriteIndex(
  cwd: string,
  packageContext: PackageContext,
  packageFiles: PackageFile[],
  platforms: Platform[],
  options: BuildIndexOptions = {}
): Promise<void> {
  const packageName = packageContext.name;
  const packageLocation = packageContext.location;

  try {
    // Filter to index-eligible files only (excludes openpackage.yml, package index file, etc.)
    // These are manifest/metadata files that are NOT synced to workspace locations
    const indexEligibleFiles = packageFiles.filter(f => {
      const normalized = normalizeRegistryPath(f.path);
      if (isSkippableRegistryPath(normalized, cwd)) return false;
      if (isAllowedRegistryPath(normalized, cwd)) return true;
      if (isRootRegistryPath(normalized)) return true;
      if (isRootCopyPath(normalized)) return true;
      return false;
    });

    // Read existing index and other indexes for conflict context
    const previousIndex = await readPackageIndex(cwd, packageName, packageLocation);
    const otherIndexes = await loadOtherPackageIndexes(cwd, packageName);

    // Resolve version (prefer previous index; otherwise read from openpackage.yml)
    let version: string | undefined = options.versionOverride || previousIndex?.workspace?.version || undefined;
    if (!version) {
      const packageYmlPath = packageContext.packageYmlPath;
      if (await exists(packageYmlPath)) {
        try {
          const packageYml = await parsePackageYml(packageYmlPath);
          version = packageYml.version;
        } catch (error) {
          logger.warn(`Failed to read openpackage.yml for version: ${error}`);
          return;
        }
      }
    }

    if (!version) {
      version = UNVERSIONED;
      logger.debug(`No version found for ${packageName}, defaulting to ${UNVERSIONED} for index update`);
    }

    // Build mapping using same flow as install
    let newMapping = await buildIndexMappingForPackageFiles(
      cwd,
      indexEligibleFiles,
      platforms,
      previousIndex,
      otherIndexes
    );

    // Optionally transform mapping:
    // - If preserveExactPaths is true: force exact file keys and strip dir keys
    // - Otherwise: preserve the planner's dir/file decisions (already respects workspace occupancy)
    if (options.preserveExactPaths) {
      newMapping = await buildExactFileMapping(cwd, indexEligibleFiles, platforms);
    }

    // Prune stale keys from previous index based on current files in .openpackage
    // This ensures keys are updated when files/directories are moved or renamed
    const currentPaths = indexEligibleFiles.map(f => f.path);
    const prunedPreviousFiles = pruneStaleKeysByCurrentFiles(
      previousIndex?.files || {},
      currentPaths
    );

    const previousFilesWithoutDirKeys = Object.fromEntries(
      Object.entries(prunedPreviousFiles).filter(([key]) => !key.endsWith('/'))
    );

    // Merge and write index
    // When preserveExactPaths is true, replace values entirely to reflect current state
    // (prevents stale platform paths from being preserved)
    const mergedFiles = mergeMappingsRespectingExisting(
      previousFilesWithoutDirKeys,
      newMapping,
      options.preserveExactPaths ?? false
    );
    const canonicalIndexPath = getPackageIndexPath(cwd, packageName, packageLocation);
    const indexRecord: PackageIndexRecord = {
      path: canonicalIndexPath,
      packageName,
      workspace: {
        hash: createWorkspaceHash(cwd),
        version
      },
      files: mergedFiles
    };
    await writePackageIndex(indexRecord);
    logger.debug(`Updated ${FILE_PATTERNS.OPENPACKAGE_INDEX_YML} for ${packageName}@${version}`);
  } catch (error) {
    logger.warn(`Failed to update ${FILE_PATTERNS.OPENPACKAGE_INDEX_YML} for ${packageName}: ${error}`);
  }
}


