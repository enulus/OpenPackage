import { dirname, join, relative, parse as parsePath, sep } from 'path';
import path from 'path';
import { promises as fs } from 'fs';

import {
  exists,
  ensureDir,
  listDirectories,
  listFiles,
  remove,
  removeEmptyDirectories,
  walkFiles,
  readTextFile
} from './fs.js';
import { writeIfChanged } from '../core/install/file-updater.js';
import { packageManager } from '../core/package.js';
import { getRegistryDirectories } from '../core/directory.js';
import { logger } from './logger.js';
import {
  FILE_PATTERNS,
} from '../constants/index.js';
import { getPlatformRootFileNames, stripRootCopyPrefix } from './platform-root-files.js';
import type { Platform } from '../core/platforms.js';
import { getAllUniversalSubdirs, platformUsesFlows } from '../core/platforms.js';
import { normalizePathForProcessing } from './path-normalization.js';
import { toTildePath } from './path-resolution.js';
import {
  isAllowedRegistryPath,
  isRootRegistryPath,
  isSkippableRegistryPath,
  normalizeRegistryPath,
  extractUniversalSubdirInfo
} from './registry-entry-filter.js';
import { mapUniversalToPlatform } from './platform-mapper.js';
import { safePrompts } from './prompts.js';
import type { InstallOptions } from '../types/index.js';
import type { PackageFile } from '../types/index.js';
import { mergeInlinePlatformOverride } from './platform-yaml-merge.js';
import { parseUniversalPath } from './platform-file.js';
import { getPlatformDefinition } from '../core/platforms.js';
import {
  sortMapping,
  ensureTrailingSlash,
  isDirKey,
  pruneNestedDirectories
} from './package-index-yml.js';
import {
  getWorkspaceIndexPath,
  readWorkspaceIndex,
  writeWorkspaceIndex
} from './workspace-index-yml.js';
import {
  buildWorkspaceOwnershipContext,
  type WorkspaceConflictOwner
} from './workspace-index-ownership.js';
import { resolvePackageContentRoot } from '../core/install/local-source-resolution.js';
import { calculateFileHash } from './hash-utils.js';
import { installPackageWithFlows, type FlowInstallResult } from '../core/install/flow-based-installer.js';
import { getTargetPath } from './workspace-index-helpers.js';
import type { WorkspaceIndexFileMapping } from '../types/workspace-index.js';

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

interface ExpandedIndexesContext {
  dirKeyOwners: Map<string, ConflictOwner[]>;
  installedPathOwners: Map<string, ConflictOwner>;
}

type ConflictResolution = 'keep-both' | 'skip' | 'overwrite';

export interface PlannedConflict {
  relPath: string;
  reason: 'owned-by-other' | 'exists-unowned';
  ownerPackage?: string;
}

interface PlannedTargetDetail {
  absPath: string;
  relPath: string;
  content: string;
  encoding?: string;
  sourcePath?: string; // Package source path for display
}

async function readPackageIndex(
  cwd: string,
  packageName: string,
  _location?: PackageIndexLocation
): Promise<PackageIndexRecord | null> {
  const record = await readWorkspaceIndex(cwd);
  const entry = record.index.packages?.[packageName];
  if (!entry) return null;
  return {
    path: entry.path ?? '',
    packageName,
    workspace: {
      version: entry.version ?? '',
      hash: undefined
    },
    files: entry.files ?? {}
  };
}

async function writePackageIndex(record: PackageIndexRecord, cwd?: string): Promise<void> {
  const resolvedCwd =
    cwd ??
    (record.path
      ? dirname(dirname(record.path))
      : undefined);
  if (!resolvedCwd) {
    logger.warn(`Unable to write workspace index for ${record.packageName}: missing cwd`);
    return;
  }

  const wsRecord = await readWorkspaceIndex(resolvedCwd);
  // Be defensive: older/invalid index files could sanitize to missing packages map.
  wsRecord.index.packages = wsRecord.index.packages ?? {};
  const entry = wsRecord.index.packages[record.packageName];
  const rawPath =
    entry?.path ??
    record.path ??
    (record.workspace?.version
      ? join(getRegistryDirectories().packages, record.packageName, record.workspace.version, sep)
      : '');
  if (!rawPath) {
    logger.warn(
      `Skipping workspace index write for ${record.packageName}: source path is unknown`
    );
    return;
  }

  const toWorkspaceRelativePath = (absolutePath: string, workspaceRoot: string): string => {
    if (!path.isAbsolute(absolutePath)) {
      return absolutePath;
    }

    const hasTrailingSlash = absolutePath.endsWith(path.sep) || absolutePath.endsWith('/');
    const pathWithoutTrailing = hasTrailingSlash ? absolutePath.slice(0, -1) : absolutePath;

    const normalizedAbs = path.normalize(pathWithoutTrailing);
    const normalizedRoot = path.normalize(workspaceRoot);

    if (
      normalizedAbs === normalizedRoot ||
      normalizedAbs.startsWith(normalizedRoot + path.sep)
    ) {
      const rel = path.relative(normalizedRoot, normalizedAbs);
      const normalizedRel = rel.split(path.sep).join('/');
      const result = normalizedRel ? `./${normalizedRel}` : './';
      return hasTrailingSlash ? result + '/' : result;
    }

    return absolutePath;
  };

  // Prefer workspace-relative paths when the source lives under the workspace root.
  // Otherwise, convert absolute paths under ~/.openpackage/ to tilde notation.
  const workspaceRelativeOrAbsolute = toWorkspaceRelativePath(rawPath, resolvedCwd);
  const pathToUse = toTildePath(workspaceRelativeOrAbsolute);

  wsRecord.index.packages[record.packageName] = {
    ...entry,
    path: pathToUse,
    version: entry?.version ?? record.workspace?.version,
    files: sortMapping(record.files ?? {})
  };

  await writeWorkspaceIndex(wsRecord);
}

// ============================================================================
// Conflict Planning Functions
// ============================================================================

export async function planConflictsForPackage(
  cwd: string,
  packageName: string,
  version: string,
  platforms: Platform[]
): Promise<PlannedConflict[]> {
  const registryEntries = await loadRegistryFileEntries(packageName, version, { cwd });
  const plannedFiles = createPlannedFiles(registryEntries);
  attachTargetsToPlannedFiles(cwd, plannedFiles, platforms);

  const otherIndexes = await loadOtherPackageIndexes(cwd, packageName);
  const context = await buildExpandedIndexesContext(cwd, otherIndexes);
  const previousIndex = await readPackageIndex(cwd, packageName);
  const previousOwnedPaths = await expandIndexToFilePaths(cwd, previousIndex);

  const conflicts: PlannedConflict[] = [];
  const seen = new Set<string>();

  for (const planned of plannedFiles) {
    for (const target of planned.targets) {
      const normalizedRel = normalizePathForProcessing(target.relPath);
      if (seen.has(normalizedRel)) {
        continue;
      }

      const owner = context.installedPathOwners.get(normalizedRel);
      if (owner) {
        conflicts.push({
          relPath: normalizedRel,
          reason: 'owned-by-other',
          ownerPackage: owner.packageName
        });
        seen.add(normalizedRel);
        continue;
      }

      if (!previousOwnedPaths.has(normalizedRel)) {
        const absTarget = join(cwd, normalizedRel);
        if (await exists(absTarget)) {
          conflicts.push({
            relPath: normalizedRel,
            reason: 'exists-unowned'
          });
          seen.add(normalizedRel);
        }
      }
    }
  }

  return conflicts.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

// ============================================================================
// Conflict Resolution Functions
// ============================================================================

async function generateLocalPath(cwd: string, relPath: string): Promise<string> {
  const parsed = parsePath(relPath);
  const directory = parsed.dir ? parsed.dir.replace(/\\/g, '/') : '';
  
  // Try .local first
  let baseName = `${parsed.name}.local${parsed.ext}`;
  let candidate = directory ? `${directory}/${baseName}` : baseName;
  let absCandidate = join(cwd, candidate);
  
  if (!(await exists(absCandidate))) {
    return normalizePathForProcessing(candidate);
  }
  
  // Try .local-1, .local-2, etc.
  let increment = 1;
  while (true) {
    baseName = `${parsed.name}.local-${increment}${parsed.ext}`;
    candidate = directory ? `${directory}/${baseName}` : baseName;
    absCandidate = join(cwd, candidate);
    
    if (!(await exists(absCandidate))) {
      return normalizePathForProcessing(candidate);
    }
    
    increment++;
  }
}

async function promptConflictResolution(
  message: string
): Promise<ConflictResolution> {
  const response = await safePrompts({
    type: 'select',
    name: 'choice',
    message,
    choices: [
      {
        title: 'Keep both (renames existing)',
        value: 'keep-both'
      },
      {
        title: 'Skip (keeps existing)',
        value: 'skip'
      },
      {
        title: 'Overwrite (replaces existing)',
        value: 'overwrite'
      }
    ]
  });

  const choice = (response as any).choice as ConflictResolution | undefined;
  return choice ?? 'skip';
}

/**
 * Prompt user for action when file content differs
 */
async function promptContentDifferenceResolution(
  workspacePath: string,
  packagePath?: string
): Promise<'overwrite' | 'skip'> {
  // Format package path as relative to package root with leading slash
  const formattedPackagePath = packagePath
    ? (packagePath.startsWith('/') ? packagePath : `/${packagePath}`)
    : undefined;
  
  const message = formattedPackagePath
    ? `Package file ${formattedPackagePath} differs from workspace file ${workspacePath}`
    : `File ${workspacePath} differs from package version`;

  const response = await safePrompts({
    type: 'select',
    name: 'choice',
    message,
    choices: [
      {
        title: 'Overwrite (use package version)',
        value: 'overwrite'
      },
      {
        title: 'Skip (keep workspace version)',
        value: 'skip'
      }
    ]
  });

  const choice = (response as any).choice as 'overwrite' | 'skip' | undefined;
  return choice ?? 'skip';
}

/**
 * Check if file content differs using hash comparison
 */
async function hasContentDifference(
  absPath: string,
  newContent: string
): Promise<boolean> {
  try {
    if (!(await exists(absPath))) {
      return false; // File doesn't exist, so no content difference
    }
    
    const existingContent = await readTextFile(absPath, 'utf8');
    
    // Quick check: if content is exactly the same, no need to hash
    if (existingContent === newContent) {
      return false;
    }
    
    // Hash comparison for definitive answer
    const [existingHash, newHash] = await Promise.all([
      calculateFileHash(existingContent),
      calculateFileHash(newContent)
    ]);
    
    return existingHash !== newHash;
  } catch (error) {
    logger.warn(`Failed to check content difference for ${absPath}: ${error}`);
    // On error, assume content differs to be safe
    return true;
  }
}

async function updateOwnerIndexAfterRename(
  owner: ConflictOwner,
  oldRelPath: string,
  newRelPath: string,
  indexByPackage: Map<string, PackageIndexRecord>,
  cwd: string
): Promise<void> {
  const normalizedOld = normalizePathForProcessing(oldRelPath);
  const normalizedNew = normalizePathForProcessing(newRelPath);
  const record = indexByPackage.get(owner.packageName);
  if (!record) return;

  if (owner.type === 'file') {
    const values = record.files[owner.key];
    if (!values) return;
    const idx = values.findIndex(mapping => {
      const target = getTargetPath(mapping);
      return normalizePathForProcessing(target) === normalizedOld;
    });
    if (idx === -1) return;
    // Update the mapping (preserve keys if it was a complex mapping)
    const oldMapping = values[idx];
    if (typeof oldMapping === 'string') {
      values[idx] = normalizedNew;
    } else {
      values[idx] = { ...oldMapping, target: normalizedNew };
    }
    await writePackageIndex(record, cwd);
  } else {
    // Directory key still valid; nothing to change.
  }
}

async function resolveConflictsForPlannedFiles(
  cwd: string,
  plannedFiles: PlannedFile[],
  context: ExpandedIndexesContext,
  otherIndexes: PackageIndexRecord[],
  previousOwnedPaths: Set<string>,
  options: InstallOptions
): Promise<string[]> {
  const warnings: string[] = [];
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const isDryRun = Boolean(options.dryRun);
  const defaultStrategy = options.conflictStrategy;
  const perPathDecisions = new Map<string, ConflictResolution>();
  if (options.conflictDecisions) {
    for (const [rawPath, decision] of Object.entries(options.conflictDecisions)) {
      perPathDecisions.set(normalizePathForProcessing(rawPath), decision as ConflictResolution);
    }
  }
  const indexByPackage = new Map<string, PackageIndexRecord>();
  for (const record of otherIndexes) {
    indexByPackage.set(record.packageName, record);
  }

  for (const planned of plannedFiles) {
    const filteredTargets: PlannedTarget[] = [];

    for (const target of planned.targets) {
      const normalizedRel = normalizePathForProcessing(target.relPath);
      const absTarget = join(cwd, normalizedRel);
      const owner = context.installedPathOwners.get(normalizedRel);

      if (owner) {
        let decision: ConflictResolution | undefined = perPathDecisions.get(normalizedRel);

        if (!decision) {
          if (options.force) {
            decision = 'keep-both';
          } else if (defaultStrategy && defaultStrategy !== 'ask') {
            decision = defaultStrategy as ConflictResolution;
            if (decision === 'skip') {
              warnings.push(`Skipping ${normalizedRel} (owned by ${owner.packageName}) due to configured conflict strategy.`);
            }
          } else if (!interactive) {
            warnings.push(`Skipping ${normalizedRel} (owned by ${owner.packageName}) due to non-interactive conflict.`);
            decision = 'skip';
          } else {
            decision = await promptConflictResolution(
              `File ${normalizedRel} is managed by package ${owner.packageName}. How would you like to proceed?`
            );
          }
        }

        if (decision === 'skip') {
          continue;
        }

        if (decision === 'keep-both') {
          if (isDryRun) {
            const localPath = await generateLocalPath(cwd, normalizedRel);
            warnings.push(`Would rename existing ${normalizedRel} from ${owner.packageName} to ${localPath} and install new file at ${normalizedRel}.`);
            filteredTargets.push(target);
            continue;
          }

          const localRelPath = await generateLocalPath(cwd, normalizedRel);
          const absLocalPath = join(cwd, localRelPath);
          await ensureDir(dirname(absLocalPath));
          try {
            await fs.rename(absTarget, absLocalPath);
            await updateOwnerIndexAfterRename(
              owner,
              normalizedRel,
              localRelPath,
              indexByPackage,
              cwd
            );
            context.installedPathOwners.delete(normalizedRel);
            context.installedPathOwners.set(normalizePathForProcessing(localRelPath), owner);
            warnings.push(`Renamed existing ${normalizedRel} from ${owner.packageName} to ${localRelPath}.`);
            filteredTargets.push(target);
          } catch (error) {
            warnings.push(`Failed to rename ${normalizedRel}: ${error}`);
          }
          continue;
        }

        // overwrite
        if (isDryRun) {
          warnings.push(`Would overwrite ${normalizedRel} (currently from ${owner.packageName}).`);
          filteredTargets.push(target);
          continue;
        }

        // Clear in-memory owner mapping to avoid repeated prompts this run
        context.installedPathOwners.delete(normalizedRel);
        filteredTargets.push(target);
        continue;
      }

      if (!previousOwnedPaths.has(normalizedRel) && (await exists(absTarget))) {
        // Check if content actually differs
        const contentDiffers = await hasContentDifference(absTarget, planned.content);
        
        if (!contentDiffers) {
          // Content is the same, no conflict - just proceed
          filteredTargets.push(target);
          continue;
        }

        // Content differs - handle as a conflict
        let decision: ConflictResolution | undefined = perPathDecisions.get(normalizedRel);

        if (!decision) {
          if (options.force) {
            // Force flag: auto-overwrite (not keep-both)
            decision = 'overwrite';
            warnings.push(`Overwriting ${normalizedRel} (content differs, --force flag active).`);
          } else if (defaultStrategy && defaultStrategy !== 'ask') {
            decision = defaultStrategy as ConflictResolution;
            if (decision === 'skip') {
              warnings.push(`Skipping ${normalizedRel} (content differs, configured conflict strategy).`);
            } else if (decision === 'overwrite') {
              warnings.push(`Overwriting ${normalizedRel} (content differs, configured conflict strategy).`);
            }
          } else if (!interactive) {
            warnings.push(`Skipping ${normalizedRel} (content differs, cannot prompt in non-interactive mode).`);
            decision = 'skip';
          } else {
            // Interactive mode: prompt for content-modified files
            const contentDecision = await promptContentDifferenceResolution(normalizedRel, planned.registryPath);
            decision = contentDecision;
          }
        }

        if (decision === 'skip') {
          continue;
        }

        if (decision === 'keep-both') {
          if (isDryRun) {
            const localPath = await generateLocalPath(cwd, normalizedRel);
            warnings.push(`Would rename existing local file ${normalizedRel} to ${localPath} and install new file at ${normalizedRel}.`);
            filteredTargets.push(target);
            continue;
          }

          const localRelPath = await generateLocalPath(cwd, normalizedRel);
          const absLocalPath = join(cwd, localRelPath);
          await ensureDir(dirname(absLocalPath));
          try {
            await fs.rename(absTarget, absLocalPath);
            warnings.push(`Renamed existing local file ${normalizedRel} to ${localRelPath}.`);
            filteredTargets.push(target);
          } catch (error) {
            warnings.push(`Failed to rename existing local file ${normalizedRel}: ${error}`);
          }
          continue;
        }

        // overwrite
        if (isDryRun) {
          warnings.push(`Would overwrite existing local file ${normalizedRel} (content modified).`);
          filteredTargets.push(target);
          continue;
        }

        filteredTargets.push(target);
        continue;
      }

      filteredTargets.push(target);
    }

    planned.targets = filteredTargets;
  }

  return warnings;
}


export interface IndexInstallResult {
  installed: number;
  updated: number;
  deleted: number;
  skipped: number;
  files: string[];
  installedFiles: string[];
  updatedFiles: string[];
  deletedFiles: string[];
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

async function buildExpandedIndexesContext(
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
// Registry File Loading Functions
// ============================================================================

async function loadRegistryFileEntries(
  packageName: string,
  version: string,
  opts?: { cwd?: string; contentRoot?: string }
): Promise<RegistryFileEntry[]> {
  const packageRootDir =
    opts?.contentRoot && (await exists(opts.contentRoot))
      ? opts.contentRoot
      : opts?.cwd
        ? await resolvePackageContentRoot({ cwd: opts.cwd, packageName, version })
        : undefined;

  const pkg = await packageManager.loadPackage(packageName, version, {
    packageRootDir
  });
  const entries: RegistryFileEntry[] = [];

  for (const file of pkg.files) {
    const normalized = normalizeRegistryPath(file.path);

    // Skip root files - these are handled by installRootFilesFromMap
    if (isRootRegistryPath(normalized)) {
      continue;
    }

    if (!isAllowedRegistryPath(normalized)) {
      // Ignore any other top-level paths (e.g., README.md, some/...)
      continue;
    }

    entries.push({
      registryPath: normalized,
      content: file.content,
      encoding: (file.encoding as string | undefined) ?? 'utf8'
    });
  }

  return entries;
}

function deriveGroupKey(registryPath: string, cwd?: string): string {
  const normalized = normalizeRegistryPath(registryPath);
  const segments = normalized.split('/');
  if (segments.length <= 1) {
    return '';
  }

  const first = segments[0];
  const universalSubdirs = getAllUniversalSubdirs(cwd);

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
// Planning Functions
// ============================================================================

function buildPlannedTargetMap(
  plannedFiles: PlannedFile[],
  cwd?: string
): Map<string, PlannedTargetDetail> {
  const map = new Map<string, PlannedTargetDetail>();

  type PlannedWithParsed = { planned: PlannedFile; parsed: ReturnType<typeof parseUniversalPath> };
  const universalPlanned: PlannedWithParsed[] = [];
  const platformSuffixedPlanned: PlannedWithParsed[] = [];

  for (const planned of plannedFiles) {
    const parsed = parseUniversalPath(planned.registryPath);
    if (parsed?.platformSuffix) {
      platformSuffixedPlanned.push({ planned, parsed });
    } else {
      universalPlanned.push({ planned, parsed });
    }
  }

  const applyPlanned = (entries: PlannedWithParsed[]) => {
    for (const { planned, parsed } of entries) {
      for (const target of planned.targets) {
        const normalizedRel = normalizePathForProcessing(target.relPath);

        // Compute per-target content (apply inline platform overrides for universal files)
        let content = planned.content;
        if (parsed && !parsed.platformSuffix && target.platform && target.platform !== 'other') {
          content = mergeInlinePlatformOverride(
            planned.content,
            target.platform as Platform,
            cwd
          );
        }

        map.set(normalizedRel, {
          absPath: target.absPath,
          relPath: normalizedRel,
          content,
          encoding: planned.encoding,
          sourcePath: planned.registryPath
        });
      }
    }
  };

  // Apply universal files first, then platform-suffixed files so platform-specific content wins when targets overlap.
  applyPlanned(universalPlanned);
  applyPlanned(platformSuffixedPlanned);

  return map;
}

function computeDiff(
  plannedMap: Map<string, PlannedTargetDetail>,
  previousOwnedPaths: Set<string>
): { planned: Map<string, PlannedTargetDetail>; deletions: string[] } {
  const deletions: string[] = [];
  for (const rel of previousOwnedPaths) {
    if (!plannedMap.has(rel)) {
      deletions.push(rel);
    }
  }
  return { planned: plannedMap, deletions };
}

async function applyFileOperations(
  cwd: string,
  planned: Map<string, PlannedTargetDetail>,
  deletions: string[],
  options: InstallOptions,
  packageName?: string,
  contentRoot?: string
): Promise<IndexInstallResult> {
  const result: IndexInstallResult = {
    installed: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    files: [],
    installedFiles: [],
    updatedFiles: [],
    deletedFiles: []
  };

  const isDryRun = Boolean(options.dryRun);
  const touched = new Set<string>();

  for (const rel of deletions) {
    const absPath = join(cwd, rel);
    if (isDryRun) {
      result.skipped++;
      continue;
    }
    try {
      await remove(absPath);
      result.deleted++;
      result.deletedFiles.push(rel);
      touched.add(rel);
    } catch (error) {
      logger.warn(`Failed to remove ${absPath}: ${error}`);
      result.skipped++;
    }
  }

  for (const [rel, detail] of planned.entries()) {
    const absPath = detail.absPath;
    
    // Check for content differences before writing
    if (await exists(absPath)) {
      const contentDiffers = await hasContentDifference(absPath, detail.content);
      
      if (contentDiffers) {
        // Content differs - need to handle conflict
        const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
        let shouldWrite = false;
        
        if (isDryRun) {
          logger.warn(`Would overwrite ${rel} (content differs from package)`);
          result.skipped++;
          continue;
        }
        
        if (options.force) {
          logger.warn(`Overwriting ${rel} (content differs, --force flag active)`);
          shouldWrite = true;
        } else if (options.conflictStrategy === 'overwrite') {
          logger.warn(`Overwriting ${rel} (content differs, configured conflict strategy)`);
          shouldWrite = true;
        } else if (options.conflictStrategy === 'skip') {
          logger.warn(`Skipping ${rel} (content differs, configured conflict strategy)`);
          result.skipped++;
          continue;
        } else if (!interactive) {
          logger.warn(`Skipping ${rel} (content differs, cannot prompt in non-interactive mode)`);
          result.skipped++;
          continue;
        } else {
          // Interactive mode: prompt user
          // Use registry path (relative to package root)
          const decision = await promptContentDifferenceResolution(rel, detail.sourcePath);
          if (decision === 'skip') {
            logger.info(`Skipped ${rel} (keeping workspace version)`);
            result.skipped++;
            continue;
          }
          shouldWrite = true;
        }
        
        if (!shouldWrite) {
          result.skipped++;
          continue;
        }
      }
    }
    
    if (isDryRun) {
      result.skipped++;
      continue;
    }

    try {
      await ensureDir(dirname(absPath));
      const outcome = await writeIfChanged(absPath, detail.content);
      if (outcome === 'created') {
        result.installed++;
        result.installedFiles.push(rel);
        touched.add(rel);
      } else if (outcome === 'updated') {
        result.updated++;
        result.updatedFiles.push(rel);
        touched.add(rel);
      } else {
        touched.add(rel);
      }
    } catch (error) {
      logger.error(`Failed to write ${absPath}: ${error}`);
      result.skipped++;
    }
  }

  if (!isDryRun) {
    const directories = new Set<string>();
    for (const rel of deletions) {
      const dirRel = dirname(rel);
      if (dirRel && dirRel !== '.') {
        directories.add(dirRel);
      }
    }
    for (const dirRel of directories) {
      const absDir = join(cwd, dirRel);
      await removeEmptyDirectories(absDir).catch(() => undefined);
      if (!(await directoryHasEntries(absDir))) {
        await remove(absDir).catch(() => undefined);
      }
    }
  }

  result.files = Array.from(touched).sort();
  return result;
}

// ============================================================================
// Index Mapping Building Functions
// ============================================================================

function refreshGroupTargetDirs(plan: GroupPlan): void {
  plan.targetDirs = collectTargetDirectories(plan.plannedFiles);
}

interface SeparatedTargets {
  dirTargets: PlannedTarget[];
  fileTargetsByRegistryPath: Map<string, PlannedTarget[]>;
}

function separateTargetsByPlatformDecision(plan: GroupPlan): SeparatedTargets {
  const dirTargets: PlannedTarget[] = [];
  const fileTargetsByRegistryPath = new Map<string, PlannedTarget[]>();

  for (const file of plan.plannedFiles) {
    const registryPath = normalizeRegistryPath(file.registryPath);
    for (const target of file.targets) {
      const platform = target.platform ?? 'other';
      const platformDecision = plan.platformDecisions.get(platform) ?? plan.decision;
      
      if (platformDecision === 'dir') {
        dirTargets.push(target);
      } else {
        if (!fileTargetsByRegistryPath.has(registryPath)) {
          fileTargetsByRegistryPath.set(registryPath, []);
        }
        fileTargetsByRegistryPath.get(registryPath)!.push(target);
      }
    }
  }

  return { dirTargets, fileTargetsByRegistryPath };
}

function buildDirKeyMapping(
  plan: GroupPlan,
  dirTargets: PlannedTarget[]
): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};
  
  if (dirTargets.length === 0 || plan.decision !== 'dir') {
    return mapping;
  }

  const dirsForDirKey = new Set<string>();
  for (const target of dirTargets) {
    const dirName = dirname(target.relPath);
    if (dirName && dirName !== '.') {
      dirsForDirKey.add(ensureTrailingSlash(normalizePathForProcessing(dirName)));
    }
  }

  if (dirsForDirKey.size > 0) {
    const key = ensureTrailingSlash(plan.key);
    const pruned = pruneNestedDirectories(Array.from(dirsForDirKey));
    const values = pruned.map(dir => ensureTrailingSlash(dir)).sort();
    mapping[key] = values;
  }

  return mapping;
}

function buildFileMappings(
  fileTargetsByRegistryPath: Map<string, PlannedTarget[]>
): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};

  for (const [registryPath, targets] of fileTargetsByRegistryPath.entries()) {
    const values = Array.from(
      new Set(
        targets.map(target => normalizePathForProcessing(target.relPath))
      )
    ).sort();
    mapping[registryPath] = values;
  }

  return mapping;
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
// Main Install Function
// ============================================================================

export async function installPackageByIndex(
  cwd: string,
  packageName: string,
  version: string,
  platforms: Platform[],
  options: InstallOptions,
  includePaths?: string[],
  contentRoot?: string
): Promise<IndexInstallResult> {
  // Check if any platform uses flows
  const hasFlowPlatforms = platforms.some(platform => platformUsesFlows(platform, cwd));
  
  if (hasFlowPlatforms) {
    logger.debug(`Platform(s) using flows detected, delegating to flow-based installer for ${packageName}`);
    
    // For now, log and continue with subdirs-based installer
    // Flow-based installer will be fully integrated in subsequent updates
    logger.warn(`Flow-based installation for ${packageName} is not yet fully implemented. Using subdirs-based installer.`);
  }
  
  const resolvedContentRoot = contentRoot ?? await resolvePackageContentRoot({ cwd, packageName, version });
  const registryEntries = await loadRegistryFileEntries(packageName, version, {
    cwd,
    contentRoot: resolvedContentRoot
  });

  const normalizedIncludes = includePaths && includePaths.length > 0
    ? new Set(includePaths.map(p => normalizeRegistryPath(p)))
    : null;

  const plannedFiles = createPlannedFiles(registryEntries).filter(planned => {
    if (!normalizedIncludes) return true;
    return normalizedIncludes.has(normalizeRegistryPath(planned.registryPath));
  });

  if (normalizedIncludes && plannedFiles.length === 0) {
    const available = registryEntries.map(e => normalizeRegistryPath(e.registryPath)).sort();
    const message = `Requested specific file(s) not found in ${packageName}@${version}. Available registry paths: ${available.join(
      ', '
    )}`;
    // Align with package-missing behavior: warn and skip instead of throwing
    logger.warn(`${message}. Skipping package install.`);
    return {
      installed: 0,
      updated: 0,
      deleted: 0,
      skipped: 1,
      files: [],
      installedFiles: [],
      updatedFiles: [],
      deletedFiles: []
    };
  }
  attachTargetsToPlannedFiles(cwd, plannedFiles, platforms);

  const groups = groupPlannedFiles(plannedFiles, cwd);
  const previousIndex = await readPackageIndex(cwd, packageName);
  const otherIndexes = await loadOtherPackageIndexes(cwd, packageName);
  const context = await buildExpandedIndexesContext(cwd, otherIndexes);
  const groupPlans = await decideGroupPlans(cwd, groups, previousIndex, context);
  const previousOwnedPaths = await expandIndexToFilePaths(cwd, previousIndex);

  const conflictWarnings = await resolveConflictsForPlannedFiles(
    cwd,
    plannedFiles,
    context,
    otherIndexes,
    previousOwnedPaths,
    options
  );
  for (const warning of conflictWarnings) {
    logger.warn(warning);
  }

  const plannedTargetMap = buildPlannedTargetMap(plannedFiles, cwd);
  const { planned, deletions } = computeDiff(plannedTargetMap, previousOwnedPaths);

  const operationResult = await applyFileOperations(cwd, planned, deletions, options, packageName, resolvedContentRoot);

  if (!options.dryRun) {
    const mapping = buildIndexMappingFromPlans(groupPlans);
    const indexRecord: PackageIndexRecord = {
      path: contentRoot ?? join(getRegistryDirectories().packages, packageName, version, sep),
      packageName,
      workspace: {
        version
      },
      files: mapping
    };
    await writePackageIndex(indexRecord, cwd);
  }

  return operationResult;
}





// ============================================================================
// Target Mapping Functions
// ============================================================================

async function expandIndexToFilePaths(
  cwd: string,
  index: PackageIndexRecord | null
): Promise<Set<string>> {
  const owned = new Set<string>();
  if (!index) return owned;

  for (const [key, values] of Object.entries(index.files)) {
    if (isDirKey(key)) {
      for (const mapping of values) {
        const dirRel = getTargetPath(mapping);
        const files = await collectFilesUnderDirectory(cwd, dirRel);
        for (const rel of files) {
          owned.add(normalizePathForProcessing(rel));
        }
      }
    } else {
      for (const mapping of values) {
        const value = getTargetPath(mapping);
        owned.add(normalizePathForProcessing(value));
      }
    }
  }

  return owned;
}


function mapRegistryPathToTargets(
  cwd: string,
  registryPath: string,
  platforms: Platform[]
): PlannedTarget[] {
  const normalized = normalizeRegistryPath(registryPath);
  const targets: PlannedTarget[] = [];

  const universalInfo = extractUniversalSubdirInfo(normalized, cwd);

  if (universalInfo) {
    // Parse the universal path to detect platform suffix and normalized relative path
    const parsed = parseUniversalPath(normalized);

    // If a platform suffix is present, only target that specific platform and drop the suffix for install path
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
          const targetAbs = join(cwd, mapped.absFile);
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

    // No platform suffix: map to all detected/selected platforms
    const rel = parsed ? parsed.relPath : universalInfo.relPath;
    for (const platform of platforms) {
      try {
        const mapped = mapUniversalToPlatform(platform, universalInfo.universalSubdir, rel, cwd);
        const targetAbs = join(cwd, mapped.absFile);
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
  // Precompute overrides: base universal path → set of platforms that have platform-suffixed variants
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
      // Universal file: exclude platforms that have platform-specific variants
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
      // Platform-suffixed file: use all targets as-is
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

  const rootDir = normalizePathForProcessing(getPlatformDefinition(platform).rootDir);

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
  // Use 'dir' if at least one platform can use it
  // (buildIndexMappingFromPlans will handle per-platform logic)
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

  // For allowed registry paths, if the file already exists at the workspace-relative path,
  // record that concrete location. This is important for root packages and for "add"/"save"
  // flows where the source path itself is the only existing workspace location before apply/install.
  for (const file of packageFiles) {
    const normalized = normalizeRegistryPath(file.path);
    if (!isAllowedRegistryPath(normalized)) continue;
    if (isSkippableRegistryPath(normalized)) continue;
    if (await exists(join(cwd, normalized))) {
      addMappingValue(augmented, normalized, normalized);
    }
  }

  // AGENTS.md can populate platform root files when no explicit override exists in the package.
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
  // Convert PackageFile[] to RegistryFileEntry[] format
  const registryEntries: RegistryFileEntry[] = packageFiles
    .filter(file => {
      const normalized = normalizeRegistryPath(file.path);
      // Skip root files and skippable paths (same logic as loadRegistryFileEntries)
      if (isRootRegistryPath(normalized)) return false;
      if (isSkippableRegistryPath(normalized)) return false;
      return isAllowedRegistryPath(normalized);
    })
    .map(file => ({
      registryPath: normalizeRegistryPath(file.path),
      content: file.content,
      encoding: file.encoding as string | undefined
    }));

  if (registryEntries.length === 0) {
    return await augmentIndexMappingWithRootAndCopyToRoot(cwd, {}, packageFiles, platforms);
  }

  // Reuse existing planning logic - this ensures consistency with installPackageByIndex
  const plannedFiles = createPlannedFiles(registryEntries);
  attachTargetsToPlannedFiles(cwd, plannedFiles, platforms);
  
  const groups = groupPlannedFiles(plannedFiles, cwd);
  const context = await buildExpandedIndexesContext(cwd, otherIndexes);
  const groupPlans = await decideGroupPlans(cwd, groups, previousIndex, context);
  
  // Build the mapping using the same logic as installPackageByIndex
  const mapping = buildIndexMappingFromPlans(groupPlans);
  return await augmentIndexMappingWithRootAndCopyToRoot(cwd, mapping, packageFiles, platforms);
}

function filterRegistryEntriesForPackageFiles(packageFiles: PackageFile[]): RegistryFileEntry[] {
  return packageFiles
    .filter(file => {
      const normalized = normalizeRegistryPath(file.path);
      if (isRootRegistryPath(normalized)) return false;
      if (isSkippableRegistryPath(normalized)) return false;
      return isAllowedRegistryPath(normalized);
    })
    .map(file => ({
      registryPath: normalizeRegistryPath(file.path),
      content: file.content,
      encoding: file.encoding as string | undefined
    }));
}

export interface PlannedSyncOutcome {
  operation: IndexInstallResult;
  mapping: Record<string, string[]>;
}

export async function applyPlannedSyncForPackageFiles(
  cwd: string,
  packageName: string,
  version: string,
  packageFiles: PackageFile[],
  platforms: Platform[],
  options: InstallOptions,
  location: PackageIndexLocation = 'nested'
): Promise<PlannedSyncOutcome> {
  const registryEntries = filterRegistryEntriesForPackageFiles(packageFiles);

  const plannedFiles = createPlannedFiles(registryEntries);
  attachTargetsToPlannedFiles(cwd, plannedFiles, platforms);

  const previousIndex = await readPackageIndex(cwd, packageName, location);
  const otherIndexes = await loadOtherPackageIndexes(cwd, packageName);
  const context = await buildExpandedIndexesContext(cwd, otherIndexes);

  const groups = groupPlannedFiles(plannedFiles, cwd);
  const groupPlans = await decideGroupPlans(cwd, groups, previousIndex, context);
  const previousOwnedPaths = await expandIndexToFilePaths(cwd, previousIndex);

  const conflictWarnings = await resolveConflictsForPlannedFiles(
    cwd,
    plannedFiles,
    context,
    otherIndexes,
    previousOwnedPaths,
    options
  );
  for (const warning of conflictWarnings) {
    logger.warn(warning);
  }

  const plannedTargetMap = buildPlannedTargetMap(plannedFiles, cwd);
  const { planned, deletions } = computeDiff(plannedTargetMap, previousOwnedPaths);

  // Try to get contentRoot from previous index for better messaging
  const contentRoot = previousIndex?.path;
  const operationResult = await applyFileOperations(cwd, planned, deletions, options, packageName, contentRoot);

  let mapping: Record<string, string[]> = {};
  if (!options.dryRun) {
    mapping = await augmentIndexMappingWithRootAndCopyToRoot(
      cwd,
      buildIndexMappingFromPlans(groupPlans),
      packageFiles,
      platforms
    );
  }

  return {
    operation: operationResult,
    mapping
  };
}







