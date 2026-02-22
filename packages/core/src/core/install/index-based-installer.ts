import { dirname, join, relative, sep } from 'path';

import {
  exists,
  ensureDir,
  listDirectories,
  listFiles,
  remove,
  removeEmptyDirectories,
  walkFiles,
} from '../../utils/fs.js';
import { packageManager } from '../package.js';
import { getRegistryDirectories } from '../directory.js';
import { logger } from '../../utils/logger.js';
import {
  FILE_PATTERNS,
} from '../../constants/index.js';
import { getPlatformRootFileNames, stripRootCopyPrefix } from '../../utils/platform-root-files.js';
import type { Platform } from '../platforms.js';
import { getPlatformsState } from '../platforms.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { formatPathForYaml } from '../../utils/path-resolution.js';
import {
  isAllowedRegistryPath,
  isRootRegistryPath,
  isSkippableRegistryPath,
  normalizeRegistryPath,
  extractUniversalSubdirInfo
} from '../../utils/registry-entry-filter.js';
import { mapUniversalToPlatform } from '../../utils/platform-mapper.js';
import type { PackageFile } from '../../types/index.js';
import { mergeInlinePlatformOverride } from '../../utils/platform-yaml-merge.js';
import { parseUniversalPath } from '../../utils/platform-file.js';
import { getPlatformDefinition, deriveRootDirFromFlows } from '../platforms.js';
import {
  sortMapping,
  ensureTrailingSlash,
  isDirKey,
  pruneNestedDirectories
} from '../../utils/package-index-yml.js';
import {
  getWorkspaceIndexPath,
  readWorkspaceIndex,
} from '../../utils/workspace-index-yml.js';
import {
  type WorkspaceConflictOwner
} from '../../utils/workspace-index-ownership.js';
import { getTargetPath } from '../../utils/workspace-index-helpers.js';
import type { WorkspaceIndexFileMapping } from '../../types/workspace-index.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

type PackageIndexLocation = 'root' | 'nested';

interface PackageIndexRecord {
  path: string;
  packageName: string;
  workspace: {
    version: string;
    hash?: string;
  };
  files: Record<string, (string | WorkspaceIndexFileMapping)[]>;
}

interface RegistryFileEntry {
  registryPath: string;
  content: string;
  encoding?: string;
}

interface PlannedTarget {
  absPath: string;
  relPath: string;
  platform?: Platform | 'other';
}

interface PlannedFile {
  registryPath: string;
  content: string;
  encoding?: string;
  targets: PlannedTarget[];
}

interface GroupPlan {
  key: string;
  plannedFiles: PlannedFile[];
  decision: 'dir' | 'file';
  platformDecisions: Map<Platform | 'other', 'dir' | 'file'>;
  targetDirs: Set<string>;
}

type ConflictOwner = WorkspaceConflictOwner;

export interface ExpandedIndexesContext {
  dirKeyOwners: Map<string, ConflictOwner[]>;
  installedPathOwners: Map<string, ConflictOwner>;
}

interface PlannedTargetDetail {
  absPath: string;
  relPath: string;
  content: string;
  encoding?: string;
  sourcePath?: string;
}

// ============================================================================
// Path and File Utilities
// ============================================================================

function normalizeRelativePath(cwd: string, absPath: string): string {
  const rel = relative(cwd, absPath);
  const normalized = normalizePathForProcessing(rel);
  return normalized.replace(/\\/g, '/');
}

export async function loadOtherPackageIndexes(
  cwd: string,
  excludePackage: string
): Promise<PackageIndexRecord[]> {
  const record = await readWorkspaceIndex(cwd);
  const wsPath = getWorkspaceIndexPath(cwd);
  const packages = record.index.packages ?? {};
  const results: PackageIndexRecord[] = [];

  for (const [name, entry] of Object.entries(packages)) {
    if (name === excludePackage) continue;
    results.push({
      path: entry?.path ?? wsPath,
      packageName: name,
      workspace: { version: entry?.version ?? '' },
      files: entry?.files ?? {}
    });
  }

  return results;
}

async function collectFilesUnderDirectory(cwd: string, dirRelPath: string): Promise<string[]> {
  const directoryRel = ensureTrailingSlash(normalizePathForProcessing(dirRelPath));
  const absDir = join(cwd, directoryRel);
  if (!(await exists(absDir))) {
    return [];
  }

  const collected: string[] = [];
  try {
    for await (const absFile of walkFiles(absDir)) {
      const relPath = normalizeRelativePath(cwd, absFile);
      collected.push(relPath);
    }
  } catch (error) {
    logger.warn(`Failed to enumerate directory ${absDir}: ${error}`);
  }
  return collected;
}

export async function buildExpandedIndexesContext(
  cwd: string,
  indexes: PackageIndexRecord[]
): Promise<ExpandedIndexesContext> {
  const dirKeyOwners = new Map<string, ConflictOwner[]>();
  const installedPathOwners = new Map<string, ConflictOwner>();

  for (const record of indexes) {
  for (const [rawKey, values] of Object.entries(record.files)) {
    const key = normalizePathForProcessing(rawKey);
    const owner: ConflictOwner = {
      packageName: record.packageName,
      key,
      type: key.endsWith('/') ? 'dir' : 'file'
    };

    if (owner.type === 'dir') {
      if (!dirKeyOwners.has(key)) {
        dirKeyOwners.set(key, []);
      }
      dirKeyOwners.get(key)!.push(owner);

      for (const mapping of values) {
        const dirRel = getTargetPath(mapping);
        const files = await collectFilesUnderDirectory(cwd, dirRel);
          for (const filePath of files) {
            if (!installedPathOwners.has(filePath)) {
              installedPathOwners.set(filePath, owner);
            }
          }
      }
    } else {
      for (const mapping of values) {
        const fileRel = getTargetPath(mapping);
        const normalizedValue = normalizePathForProcessing(fileRel);
          if (!installedPathOwners.has(normalizedValue)) {
            installedPathOwners.set(normalizedValue, owner);
          }
        }
      }
    }
  }

  return { dirKeyOwners, installedPathOwners };
}

// ============================================================================
// Group Planning Functions
// ============================================================================

function deriveGroupKey(registryPath: string, cwd?: string): string {
  const normalized = normalizeRegistryPath(registryPath);
  const segments = normalized.split('/');
  if (segments.length <= 1) {
    return '';
  }

  const first = segments[0];
  const state = getPlatformsState(cwd ?? null);
  const universalSubdirs = state.universalSubdirs;

  if (universalSubdirs.has(first)) {
    if (segments.length >= 2) {
      return ensureTrailingSlash(`${segments[0]}/${segments[1]}`);
    }
    return ensureTrailingSlash(`${segments[0]}`);
  }

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) return '';
  return ensureTrailingSlash(normalized.substring(0, lastSlash));
}

function createPlannedFiles(entries: RegistryFileEntry[]): PlannedFile[] {
  return entries.map(entry => ({
    registryPath: entry.registryPath,
    content: entry.content,
    encoding: entry.encoding,
    targets: []
  }));
}

function groupPlannedFiles(plannedFiles: PlannedFile[], cwd?: string): Map<string, PlannedFile[]> {
  const groups = new Map<string, PlannedFile[]>();
  for (const planned of plannedFiles) {
    const key = deriveGroupKey(planned.registryPath, cwd);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(planned);
  }
  return groups;
}

// ============================================================================
// Index Mapping Building Functions
// ============================================================================

function refreshGroupTargetDirs(plan: GroupPlan): void {
  plan.targetDirs = collectTargetDirectories(plan.plannedFiles);
}

function buildFallbackFileMappings(plan: GroupPlan): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};

  for (const file of plan.plannedFiles) {
    if (file.targets.length === 0) continue;
    const values = Array.from(
      new Set(
        file.targets.map(target => normalizePathForProcessing(target.relPath))
      )
    ).sort();
    mapping[normalizeRegistryPath(file.registryPath)] = values;
  }

  return mapping;
}

function buildIndexMappingFromPlans(plans: GroupPlan[]): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};

  for (const plan of plans) {
    refreshGroupTargetDirs(plan);
    const fileMappings = buildFallbackFileMappings(plan);
    for (const [registryPath, values] of Object.entries(fileMappings)) {
      const existing = mapping[registryPath] ?? [];
      mapping[registryPath] = Array.from(new Set([...existing, ...values]));
    }
  }

  return sortMapping(mapping);
}

// ============================================================================
// Target Mapping Functions
// ============================================================================

function mapRegistryPathToTargets(
  cwd: string,
  registryPath: string,
  platforms: Platform[]
): PlannedTarget[] {
  const normalized = normalizeRegistryPath(registryPath);
  const targets: PlannedTarget[] = [];

  const universalInfo = extractUniversalSubdirInfo(normalized, cwd);

  if (universalInfo) {
    const parsed = parseUniversalPath(normalized);

    if (parsed?.platformSuffix) {
      const targetPlatform = parsed.platformSuffix as Platform;
      if (platforms.includes(targetPlatform)) {
        try {
          const mapped = mapUniversalToPlatform(
            targetPlatform,
            parsed.universalSubdir,
            parsed.relPath,
            cwd
          );
          const targetAbs = join(cwd, mapped.relFile);
          targets.push({
            absPath: targetAbs,
            relPath: normalizeRelativePath(cwd, targetAbs),
            platform: targetPlatform
          });
        } catch (error) {
          logger.debug(`Platform ${targetPlatform} does not support ${normalized}: ${error}`);
        }
      }
      return targets;
    }

    const rel = parsed ? parsed.relPath : universalInfo.relPath;
    for (const platform of platforms) {
      try {
        const mapped = mapUniversalToPlatform(platform, universalInfo.universalSubdir, rel, cwd);
        const targetAbs = join(cwd, mapped.relFile);
        targets.push({
          absPath: targetAbs,
          relPath: normalizeRelativePath(cwd, targetAbs),
          platform
        });
      } catch (error) {
        logger.debug(`Platform ${platform} does not support ${normalized}: ${error}`);
      }
    }
    return targets;
  }

  const fallbackAbs = join(cwd, normalized);
  targets.push({
    absPath: fallbackAbs,
    relPath: normalizeRelativePath(cwd, fallbackAbs),
    platform: 'other'
  });
  return targets;
}

function attachTargetsToPlannedFiles(
  cwd: string,
  plannedFiles: PlannedFile[],
  platforms: Platform[]
): void {
  const overriddenByBase = new Map<string, Set<Platform>>();
  for (const pf of plannedFiles) {
    const parsed = parseUniversalPath(pf.registryPath);
    if (parsed?.platformSuffix) {
      const baseKey = `${parsed.universalSubdir}/${parsed.relPath}`;
      if (!overriddenByBase.has(baseKey)) {
        overriddenByBase.set(baseKey, new Set());
      }
      overriddenByBase.get(baseKey)!.add(parsed.platformSuffix as Platform);
    }
  }

  for (const planned of plannedFiles) {
    const targets = mapRegistryPathToTargets(cwd, planned.registryPath, platforms);

    const parsed = parseUniversalPath(planned.registryPath);
    if (parsed && !parsed.platformSuffix) {
      const baseKey = `${parsed.universalSubdir}/${parsed.relPath}`;
      const excludedPlatforms = overriddenByBase.get(baseKey);
      if (excludedPlatforms && excludedPlatforms.size > 0) {
        planned.targets = targets.filter(t =>
          !(t.platform && t.platform !== 'other' && excludedPlatforms.has(t.platform as Platform))
        );
      } else {
        planned.targets = targets;
      }
    } else {
      planned.targets = targets;
    }
  }
}

// ============================================================================
// Directory Collection Functions
// ============================================================================

function collectTargetDirectories(plannedFiles: PlannedFile[]): Set<string> {
  const dirs = new Set<string>();
  for (const planned of plannedFiles) {
    for (const target of planned.targets) {
      const dirName = dirname(target.relPath);
      if (!dirName || dirName === '.') continue;
      dirs.add(ensureTrailingSlash(normalizePathForProcessing(dirName)));
    }
  }
  return dirs;
}

function collectTargetDirectoriesByPlatform(
  plannedFiles: PlannedFile[]
): Map<Platform | 'other', Set<string>> {
  const dirsByPlatform = new Map<Platform | 'other', Set<string>>();
  
  for (const planned of plannedFiles) {
    for (const target of planned.targets) {
      const platform = target.platform ?? 'other';
      if (!dirsByPlatform.has(platform)) {
        dirsByPlatform.set(platform, new Set());
      }
      const dirName = dirname(target.relPath);
      if (!dirName || dirName === '.') continue;
      dirsByPlatform.get(platform)!.add(ensureTrailingSlash(normalizePathForProcessing(dirName)));
    }
  }
  
  return dirsByPlatform;
}

async function directoryHasEntries(absDir: string): Promise<boolean> {
  if (!(await exists(absDir))) return false;
  const files = await listFiles(absDir).catch(() => [] as string[]);
  if (files.length > 0) return true;
  const subdirs = await listDirectories(absDir).catch(() => [] as string[]);
  return subdirs.length > 0;
}

// ============================================================================
// Platform Decision Functions
// ============================================================================

async function checkPlatformDirectoryOccupancy(
  cwd: string,
  platformDirs: Set<string>
): Promise<boolean> {
  for (const dirRel of platformDirs) {
    const absDir = join(cwd, dirRel);
    if (await directoryHasEntries(absDir)) {
      return true;
    }
  }
  return false;
}

function hadPreviousDirForPlatform(
  previousIndex: PackageIndexRecord | null,
  groupKey: string,
  platform: Platform | 'other'
): boolean {
  if (!previousIndex || platform === 'other') {
    return false;
  }

  const prevValues = previousIndex.files[groupKey] ?? [];
  if (prevValues.length === 0) {
    return false;
  }

  const platformDef = getPlatformDefinition(platform);
  const rootDir = normalizePathForProcessing(deriveRootDirFromFlows(platformDef));

  for (const mapping of prevValues) {
    const value = getTargetPath(mapping);
    const normalizedValue = normalizePathForProcessing(value);
    if (
      normalizedValue === rootDir ||
      normalizedValue.startsWith(`${rootDir}/`)
    ) {
      return true;
    }
  }

  return false;
}

async function determinePlatformDecisions(
  cwd: string,
  targetDirsByPlatform: Map<Platform | 'other', Set<string>>,
  wasDirKey: boolean,
  previousIndex: PackageIndexRecord | null,
  groupKey: string
): Promise<Map<Platform | 'other', 'dir' | 'file'>> {
  const platformDecisions = new Map<Platform | 'other', 'dir' | 'file'>();

  for (const [platform, platformDirs] of targetDirsByPlatform.entries()) {
    if (wasDirKey && hadPreviousDirForPlatform(previousIndex, groupKey, platform)) {
      platformDecisions.set(platform, 'dir');
      continue;
    }

    const directoryOccupied = await checkPlatformDirectoryOccupancy(cwd, platformDirs);
    platformDecisions.set(platform, directoryOccupied ? 'file' : 'dir');
  }

  return platformDecisions;
}

function computeOverallDecision(
  platformDecisions: Map<Platform | 'other', 'dir' | 'file'>
): 'dir' | 'file' {
  const hasAnyDirDecision = Array.from(platformDecisions.values()).some(d => d === 'dir');
  return hasAnyDirDecision ? 'dir' : 'file';
}

async function decideGroupPlans(
  cwd: string,
  groups: Map<string, PlannedFile[]>,
  previousIndex: PackageIndexRecord | null,
  context: ExpandedIndexesContext
): Promise<GroupPlan[]> {
  const plans: GroupPlan[] = [];
  const previousDirKeys = new Set(
    previousIndex
      ? Object.keys(previousIndex.files).filter(key => isDirKey(key))
      : []
  );

  for (const [groupKey, plannedFiles] of groups.entries()) {
    const targetDirs = collectTargetDirectories(plannedFiles);
    const targetDirsByPlatform = collectTargetDirectoriesByPlatform(plannedFiles);
    let decision: 'dir' | 'file' = 'file';
    const platformDecisions = new Map<Platform | 'other', 'dir' | 'file'>();

    const otherDirOwners = context.dirKeyOwners.get(groupKey) ?? [];
    const hasTargets = plannedFiles.some(file => file.targets.length > 0);

    if (groupKey !== '' && hasTargets && otherDirOwners.length === 0) {
      const wasDirKey = previousDirKeys.has(groupKey);
      const computedDecisions = await determinePlatformDecisions(
        cwd,
        targetDirsByPlatform,
        wasDirKey,
        previousIndex,
        groupKey
      );
      platformDecisions.clear();
      computedDecisions.forEach((value, key) => platformDecisions.set(key, value));
      decision = computeOverallDecision(platformDecisions);
    }

    plans.push({
      key: groupKey,
      plannedFiles,
      decision,
      platformDecisions,
      targetDirs
    });
  }

  return plans;
}

// ============================================================================
// Shared Helper for Building Index Mappings
// ============================================================================

function addMappingValue(mapping: Record<string, string[]>, key: string, value: string): void {
  if (!mapping[key]) {
    mapping[key] = [];
  }
  if (!mapping[key]!.includes(value)) {
    mapping[key]!.push(value);
  }
}

async function augmentIndexMappingWithRootAndCopyToRoot(
  cwd: string,
  mapping: Record<string, string[]>,
  packageFiles: PackageFile[],
  platforms: Platform[]
): Promise<Record<string, string[]>> {
  const augmented: Record<string, string[]> = { ...mapping };

  const rootFileNames = getPlatformRootFileNames(platforms);
  const explicitRootKeys = new Set<string>();
  const hasAgents = packageFiles.some(file => normalizeRegistryPath(file.path) === FILE_PATTERNS.AGENTS_MD);

  for (const file of packageFiles) {
    const normalized = normalizeRegistryPath(file.path);

    const stripped = stripRootCopyPrefix(normalized);
    if (stripped !== null) {
      if (await exists(join(cwd, stripped))) {
        addMappingValue(augmented, normalized, stripped);
      }
      continue;
    }

    if (rootFileNames.has(normalized) || isRootRegistryPath(normalized)) {
      explicitRootKeys.add(normalized);
      if (await exists(join(cwd, normalized))) {
        addMappingValue(augmented, normalized, normalized);
      }
    }
  }

  for (const file of packageFiles) {
    const normalized = normalizeRegistryPath(file.path);
    if (!isAllowedRegistryPath(normalized, cwd)) continue;
    if (isSkippableRegistryPath(normalized, cwd)) continue;
    if (await exists(join(cwd, normalized))) {
      addMappingValue(augmented, normalized, normalized);
    }
  }

  if (hasAgents) {
    for (const rootFile of rootFileNames) {
      if (rootFile === FILE_PATTERNS.AGENTS_MD) continue;
      if (explicitRootKeys.has(rootFile)) continue;
      if (await exists(join(cwd, rootFile))) {
        addMappingValue(augmented, FILE_PATTERNS.AGENTS_MD, rootFile);
      }
    }
  }

  return sortMapping(augmented);
}

/**
 * Build index mapping for package files using the same logic flow as installPackageByIndex
 * This function reuses the planning, grouping, and decision logic to ensure consistency
 * between installation and sync operations.
 * 
 * @param cwd - Current working directory
 * @param packageFiles - Array of package files to build mapping for
 * @param platforms - Platforms to map files to
 * @param previousIndex - Previous index record (if any)
 * @param otherIndexes - Other package indexes for conflict detection
 * @returns Record mapping registry paths to installed paths
 */
export async function buildIndexMappingForPackageFiles(
  cwd: string,
  packageFiles: PackageFile[],
  platforms: Platform[],
  previousIndex: PackageIndexRecord | null,
  otherIndexes: PackageIndexRecord[]
): Promise<Record<string, string[]>> {
  const registryEntries: RegistryFileEntry[] = packageFiles
    .filter(file => {
      const normalized = normalizeRegistryPath(file.path);
      if (isRootRegistryPath(normalized)) return false;
      if (isSkippableRegistryPath(normalized, cwd)) return false;
      return isAllowedRegistryPath(normalized, cwd);
    })
    .map(file => ({
      registryPath: normalizeRegistryPath(file.path),
      content: file.content,
      encoding: file.encoding as string | undefined
    }));

  if (registryEntries.length === 0) {
    return await augmentIndexMappingWithRootAndCopyToRoot(cwd, {}, packageFiles, platforms);
  }

  const plannedFiles = createPlannedFiles(registryEntries);
  attachTargetsToPlannedFiles(cwd, plannedFiles, platforms);
  
  const groups = groupPlannedFiles(plannedFiles, cwd);
  const context = await buildExpandedIndexesContext(cwd, otherIndexes);
  const groupPlans = await decideGroupPlans(cwd, groups, previousIndex, context);
  
  const mapping = buildIndexMappingFromPlans(groupPlans);
  return await augmentIndexMappingWithRootAndCopyToRoot(cwd, mapping, packageFiles, platforms);
}
