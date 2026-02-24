/**
 * File-Level Conflict Resolver
 *
 * Detects and resolves file-level conflicts for flow-based installs.
 * Uses package-name namespacing to organise conflicting files into
 * per-package subdirectories, preserving all versions on disk.
 */

import { dirname, join } from 'path';
import { promises as fs } from 'fs';

import { exists, ensureDir, readTextFile, walkFiles } from '../../../utils/fs.js';
import { normalizePathForProcessing } from '../../../utils/path-normalization.js';
import { formatPathForYaml } from '../../../utils/path-resolution.js';
import { calculateFileHash } from '../../../utils/hash-utils.js';
import { getTargetPath } from '../../../utils/workspace-index-helpers.js';
import { sortMapping, isDirKey, ensureTrailingSlash } from '../../../utils/package-index-yml.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../../utils/workspace-index-yml.js';
import { getRegistryDirectories } from '../../directory.js';
import { sep } from 'path';
import type { PromptPort } from '../../ports/prompt.js';
import { resolvePrompt } from '../../ports/resolve.js';
import { logger } from '../../../utils/logger.js';
import { deriveNamespaceSlug } from '../../../utils/plugin-naming.js';
import type { InstallOptions } from '../../../types/index.js';
import type { WorkspaceConflictOwner } from '../../../utils/workspace-index-ownership.js';
import type { WorkspaceIndexFileMapping } from '../../../types/workspace-index.js';
import {
  loadOtherPackageIndexes,
  buildExpandedIndexesContext,
  type ExpandedIndexesContext,
} from '../index-based-installer.js';

// ============================================================================
// Internal Types
// ============================================================================

type ConflictResolution = 'namespace' | 'skip' | 'overwrite';

interface PackageIndexRecord {
  path: string;
  packageName: string;
  workspace: {
    version: string;
    hash?: string;
  };
  files: Record<string, (string | WorkspaceIndexFileMapping)[]>;
}

// ============================================================================
// Public Types
// ============================================================================

export type FileConflictType = 'none' | 'owned-by-other' | 'exists-unowned';

export interface FileConflictInfo {
  type: FileConflictType;
  /** Set when type === 'owned-by-other' */
  owner?: WorkspaceConflictOwner;
}

export interface OwnershipContext {
  expandedIndexes: ExpandedIndexesContext;
  /** Paths the current package already owned (so re-installs skip the conflict check) */
  previousOwnedPaths: Set<string>;
  /** Raw index records keyed by package name (needed for namespace index updates) */
  indexByPackage: Map<string, PackageIndexRecord>;
}

/** A resolved target path together with the content that will be written there */
export interface TargetEntry {
  /** Workspace-relative path (forward-slash, normalised) */
  relPath: string;
  /** Absolute path */
  absPath: string;
  /**
   * Content of the source file.  Used only for the 'exists-unowned' branch
   * where we compare content before deciding whether a conflict exists.
   * Leave undefined if you want to skip the content-diff check for that branch.
   */
  content?: string;
  /**
   * The resolved `flow.to` pattern that produced this target path.
   * Used to derive the namespace insertion point (the base directory of the
   * pattern, i.e. everything before the first glob character).
   * e.g. "rules/**\/*.md" → base = "rules"
   */
  flowToPattern?: string;
  /**
   * True when the flow that produced this entry uses a merge strategy
   * (deep, shallow, or composite).  Merge-flow targets are excluded from
   * namespacing because they intentionally combine content from multiple
   * packages into a single file (e.g. mcp.json, settings.json).
   */
  isMergeFlow?: boolean;
}

/** A file that was physically moved from one location to another during namespace resolution */
export interface RelocatedFile {
  /** Original workspace-relative path before relocation */
  from: string;
  /** New workspace-relative path after relocation */
  to: string;
}

export interface ConflictResolutionResult {
  /** Targets that should proceed to flow execution (paths may be rewritten to namespaced form) */
  allowedTargets: TargetEntry[];
  /** Human-readable warnings/notes accumulated during resolution */
  warnings: string[];
  /**
   * True when at least one conflict triggered bulk namespacing for the
   * installing package.  The flow-based strategy uses this to rewrite the
   * flow `to` patterns before executing flows so that the executor writes
   * files to the correct namespaced locations.
   */
  packageWasNamespaced: boolean;
  /**
   * The package name used as the namespace directory segment.
   * Only set when packageWasNamespaced is true.
   */
  namespaceDir?: string;
  /**
   * Files that were physically relocated on disk during namespace resolution.
   * These are files owned by *other* packages that were moved into their
   * own namespace subdirectories to make room for the incoming package.
   */
  relocatedFiles: RelocatedFile[];
}

// ============================================================================
// Private: expand a package's index to its owned file paths
// (moved from index-based-installer.ts)
// ============================================================================

async function collectFilesUnderDirectory(cwd: string, dirRelPath: string): Promise<string[]> {
  const directoryRel = ensureTrailingSlash(normalizePathForProcessing(dirRelPath));
  const absDir = join(cwd, directoryRel);
  if (!(await exists(absDir))) {
    return [];
  }

  const collected: string[] = [];
  try {
    for await (const absFile of walkFiles(absDir)) {
      // normalizeRelativePath inline
      const { relative: relFn } = await import('path');
      const rel = relFn(cwd, absFile);
      collected.push(normalizePathForProcessing(rel).replace(/\\/g, '/'));
    }
  } catch (error) {
    logger.warn(`Failed to enumerate directory ${absDir}: ${error}`);
  }
  return collected;
}

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

// ============================================================================
// Private: prompt helpers
// ============================================================================

async function promptConflictResolution(message: string, prompt: PromptPort): Promise<ConflictResolution> {
  return prompt.select<ConflictResolution>(
    message,
    [
      { title: 'Namespace (organise by package name)', value: 'namespace' },
      { title: 'Skip (keeps existing)',                value: 'skip'      },
      { title: 'Overwrite (replaces existing)',        value: 'overwrite' }
    ]
  );
}

async function promptContentDifferenceResolution(
  workspacePath: string,
  prompt: PromptPort,
  sourcePath?: string
): Promise<'overwrite' | 'skip'> {
  const formattedSource = sourcePath
    ? (sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`)
    : undefined;
  const message = formattedSource
    ? `Package file ${formattedSource} differs from workspace file ${workspacePath}`
    : `File ${workspacePath} differs from package version`;

  return prompt.select<'overwrite' | 'skip'>(
    message,
    [
      { title: 'Overwrite (use package version)',  value: 'overwrite' },
      { title: 'Skip (keep workspace version)',    value: 'skip'      }
    ]
  );
}

// ============================================================================
// Private: content-difference check
// ============================================================================

async function hasContentDifference(absPath: string, newContent: string): Promise<boolean> {
  try {
    if (!(await exists(absPath))) return false;
    const existing = await readTextFile(absPath, 'utf8');
    if (existing === newContent) return false;
    const [existingHash, newHash] = await Promise.all([
      calculateFileHash(existing),
      calculateFileHash(newContent)
    ]);
    return existingHash !== newHash;
  } catch (error) {
    logger.warn(`Failed to check content difference for ${absPath}: ${error}`);
    return true; // assume differs on error — safer to prompt than to silently skip
  }
}

// ============================================================================
// Private: derive a namespaced path for a target
// ============================================================================

/**
 * Insert `packageName` as a subdirectory immediately after the base directory
 * of the flow's `to` pattern.
 *
 * The insertion point is the longest non-glob prefix of `flowToPattern`.
 * For example:
 *   relPath="rules/git/commits.md", packageName="acme", flowToPattern="rules/**\/*.md"
 *   → base="rules" → "rules/acme/git/commits.md"
 *
 *   relPath=".cursor/rules/my-rule.mdc", packageName="corp", flowToPattern=".cursor/rules/**"
 *   → base=".cursor/rules" → ".cursor/rules/corp/my-rule.mdc"
 *
 *   relPath="agents/helper.md", packageName="my-pkg", flowToPattern="agents/*"
 *   → base="agents" → "agents/my-pkg/helper.md"
 *
 * When `flowToPattern` is undefined (no metadata available), falls back to
 * inserting the namespace after the first path segment.
 */
export function generateNamespacedPath(
  relPath: string,
  packageName: string,
  flowToPattern: string | undefined
): string {
  const normalized = relPath.replace(/\\/g, '/');

  // Derive the base directory from the flow pattern (everything before the first glob)
  let baseDir = '';
  if (flowToPattern) {
    const patternNorm = flowToPattern.replace(/\\/g, '/');
    const firstGlob = patternNorm.search(/[*?{]/);
    if (firstGlob > 0) {
      // Strip trailing slash from the prefix before the glob
      const prefix = patternNorm.slice(0, firstGlob).replace(/\/$/, '');
      // The base is the directory portion of the prefix
      const lastSlash = prefix.lastIndexOf('/');
      baseDir = lastSlash >= 0 ? prefix.slice(0, lastSlash) : '';
      // If prefix itself ends with a complete segment (no trailing slash was present),
      // the full prefix is the base dir
      if (!patternNorm[firstGlob - 1]?.match(/\//)) {
        baseDir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
      } else {
        baseDir = prefix;
      }
    } else if (firstGlob === -1) {
      // Literal pattern — base is the directory of the literal target
      const lastSlash = patternNorm.lastIndexOf('/');
      baseDir = lastSlash >= 0 ? patternNorm.slice(0, lastSlash) : '';
    }
  }

  if (!baseDir) {
    // Fallback: insert namespace after the first path segment
    const parts = normalized.split('/');
    if (parts.length <= 1) {
      return `${packageName}/${normalized}`;
    }
    return `${parts[0]}/${packageName}/${parts.slice(1).join('/')}`;
  }

  // Verify the target actually starts with the base dir
  const baseDirSlash = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  if (normalized.startsWith(baseDirSlash) || normalized === baseDir) {
    const rest = normalized.slice(baseDirSlash.length);
    return rest ? `${baseDir}/${packageName}/${rest}` : `${baseDir}/${packageName}`;
  }

  // Fallback if base doesn't match (shouldn't happen in normal usage)
  const parts = normalized.split('/');
  if (parts.length <= 1) {
    return `${packageName}/${normalized}`;
  }
  return `${parts[0]}/${packageName}/${parts.slice(1).join('/')}`;
}

/**
 * Rewrite a flow's `to` pattern to insert `packageName` after the pattern's
 * base directory.  This is used to redirect an entire flow's output into a
 * namespaced subdirectory without changing individual source files.
 *
 * Examples:
 *   "rules/**\/*.md" + "acme"  → "rules/acme/**\/*.md"
 *   ".cursor/rules/**"  + "corp"  → ".cursor/rules/corp/**"
 *   "agents/*"          + "my-pkg" → "agents/my-pkg/*"
 *   ".cursor/mcp.json"  + "pkg"    → ".cursor/pkg/mcp.json"  (literal)
 */
export function namespaceFlowToPattern(pattern: string, packageName: string): string {
  const normalized = pattern.replace(/\\/g, '/');
  const firstGlob = normalized.search(/[*?{]/);

  if (firstGlob === -1) {
    // Literal path — insert namespace before the filename
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash < 0) return `${packageName}/${normalized}`;
    return `${normalized.slice(0, lastSlash)}/${packageName}/${normalized.slice(lastSlash + 1)}`;
  }

  // Find the last '/' before the first glob — that's the insertion point
  const prefix = normalized.slice(0, firstGlob);
  const lastSlash = prefix.lastIndexOf('/');
  if (lastSlash < 0) {
    // Pattern starts directly with a glob (e.g. "*.md") — prefix with namespace
    return `${packageName}/${normalized}`;
  }

  const baseDir = prefix.slice(0, lastSlash); // e.g. "rules"
  const rest = normalized.slice(lastSlash + 1); // e.g. "**/*.md"
  return `${baseDir}/${packageName}/${rest}`;
}

// ============================================================================
// Private: update owner's workspace index after a namespace move
// ============================================================================

async function updateOwnerIndexAfterRename(
  cwd: string,
  owner: WorkspaceConflictOwner,
  oldRelPath: string,
  newRelPath: string,
  indexByPackage: Map<string, PackageIndexRecord>
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
    const oldMapping = values[idx];
    values[idx] = typeof oldMapping === 'string'
      ? normalizedNew
      : { ...oldMapping, target: normalizedNew };
  }
  // dir-key owners: directory key is still valid after rename, nothing to change.

  // Persist to workspace index
  const wsRecord = await readWorkspaceIndex(cwd);
  wsRecord.index.packages = wsRecord.index.packages ?? {};
  const entry = wsRecord.index.packages[record.packageName];

  const rawPath =
    entry?.path ??
    record.path ??
    (record.workspace?.version
      ? join(getRegistryDirectories().packages, record.packageName, record.workspace.version, sep)
      : '');
  if (!rawPath) {
    logger.warn(`Skipping workspace index write for ${record.packageName}: source path unknown`);
    return;
  }

  const pathToUse = formatPathForYaml(rawPath, cwd);
  wsRecord.index.packages[record.packageName] = {
    ...entry,
    path: pathToUse,
    version: entry?.version ?? record.workspace?.version,
    files: sortMapping(record.files ?? {})
  };

  await writeWorkspaceIndex(wsRecord);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the ownership context needed for conflict checks on a single install run.
 *
 * @param cwd             - Workspace root
 * @param packageName     - Package being installed (excluded from "other owners")
 * @param previousRecord  - Workspace-index record for this package from the previous install,
 *                          or null if this is a fresh install.
 */
export async function buildOwnershipContext(
  cwd: string,
  packageName: string,
  previousRecord: { files: Record<string, (string | WorkspaceIndexFileMapping)[]> } | null
): Promise<OwnershipContext> {
  const otherIndexes = await loadOtherPackageIndexes(cwd, packageName);
  const expandedIndexes = await buildExpandedIndexesContext(cwd, otherIndexes);

  // Build previousOwnedPaths from the caller-supplied record (avoids reading the index again)
  const previousIndex: PackageIndexRecord | null = previousRecord
    ? {
        path: '',
        packageName,
        workspace: { version: '' },
        files: previousRecord.files
      }
    : null;
  const previousOwnedPaths = await expandIndexToFilePaths(cwd, previousIndex);

  const indexByPackage = new Map<string, PackageIndexRecord>();
  for (const rec of otherIndexes) {
    indexByPackage.set(rec.packageName, rec);
  }

  return { expandedIndexes, previousOwnedPaths, indexByPackage };
}

/**
 * Classify a single target path as conflict-free, owned-by-another-package, or
 * existing-on-disk-but-unowned.
 */
export function classifyFileConflict(
  targetRelPath: string,
  ownershipContext: OwnershipContext
): FileConflictInfo {
  const normalized = normalizePathForProcessing(targetRelPath);
  const owner = ownershipContext.expandedIndexes.installedPathOwners.get(normalized);

  if (owner) {
    return { type: 'owned-by-other', owner };
  }

  // For the 'exists-unowned' classification we only report the type here;
  // the caller must also check disk existence (and optionally content).
  if (!ownershipContext.previousOwnedPaths.has(normalized)) {
    return { type: 'exists-unowned' };
  }

  return { type: 'none' };
}

/**
 * Decide what to do for a single classified conflict.
 *
 * The decision cascade is:
 *   1. Per-path override (`options.conflictDecisions`)
 *   2. `--force` flag
 *   3. Configured strategy (`options.conflictStrategy`, when not 'ask')
 *   4. Default: 'namespace' for owned-by-other, TTY prompt for exists-unowned
 *   5. Non-interactive fallback: namespace (owned-by-other) / skip (exists-unowned)
 *
 * @param conflictType    - 'owned-by-other' or 'exists-unowned'
 * @param relPath         - Workspace-relative path (for display / per-path key lookup)
 * @param ownerName       - Package name of the owner (only relevant for 'owned-by-other')
 * @param sourcePath      - Package-relative source path (shown in prompts)
 * @param options              - Install options carrying force / conflictStrategy / conflictDecisions
 * @param interactive          - Whether prompts are allowed for conflict resolution
 *                               (derived from InteractionPolicy at the call site)
 * @param forceOverwrite       - True when the package-level phase confirmed an overwrite for this pkg
 */
export async function resolveFileConflict(
  conflictType: 'owned-by-other' | 'exists-unowned',
  relPath: string,
  ownerName: string | undefined,
  sourcePath: string | undefined,
  options: InstallOptions,
  interactive: boolean,
  forceOverwrite: boolean,
  prompt?: PromptPort
): Promise<{ decision: ConflictResolution; warning?: string }> {
  const perPathDecisions = options.conflictDecisions ?? {};
  const normalized = normalizePathForProcessing(relPath);

  // 1. Per-path override
  const perPath = perPathDecisions[normalized] ?? perPathDecisions[relPath];
  if (perPath) {
    return { decision: perPath as ConflictResolution };
  }

  // 2. Force flag or package-level force-overwrite confirmation
  if (options.force || forceOverwrite) {
    // --force still namespaces owned-by-other (both packages keep their file);
    // for unowned files --force overwrites since there's no package to namespace to.
    const resolution: ConflictResolution =
      conflictType === 'owned-by-other' ? 'namespace' : 'overwrite';
    const warning = conflictType === 'owned-by-other'
      ? `Namespacing ${normalized} (owned by ${ownerName}) due to --force.`
      : `Overwriting ${normalized} (content differs, --force active).`;
    return { decision: resolution, warning };
  }

  const strategy = options.conflictStrategy;

  // 3. Explicit non-'ask' strategy
  if (strategy && strategy !== 'ask') {
    const decision = strategy as ConflictResolution;
    let warning: string | undefined;
    if (decision === 'skip') {
      warning = conflictType === 'owned-by-other'
        ? `Skipping ${normalized} (owned by ${ownerName}) due to conflict strategy '${strategy}'.`
        : `Skipping ${normalized} (content differs) due to conflict strategy '${strategy}'.`;
    } else if (decision === 'overwrite' && conflictType === 'exists-unowned') {
      warning = `Overwriting ${normalized} (content differs) due to conflict strategy '${strategy}'.`;
    }
    return { decision, warning };
  }

  // 4a. Default for owned-by-other: always namespace (no prompt needed)
  if (conflictType === 'owned-by-other') {
    return { decision: 'namespace' };
  }

  // 4b. exists-unowned: prompt in interactive mode
  if (interactive) {
    const p = prompt ?? resolvePrompt();
    const decision = await promptContentDifferenceResolution(normalized, p, sourcePath);
    return { decision };
  }

  // 5. Non-interactive fallback for exists-unowned: skip
  const warning = `Skipping ${normalized} (content differs) — non-interactive mode.`;
  return { decision: 'skip', warning };
}

/**
 * Execute the namespace strategy for an `owned-by-other` conflict:
 * moves the existing file (owned by another package) into its own namespace
 * subdirectory and updates that package's workspace index entry.
 *
 * The incoming file's namespaced path is computed separately via
 * `generateNamespacedPath()` and is NOT written here — that is handled
 * by the flow executor after the target entries are rewritten.
 *
 * @param ownerNamespaceSlug  The derived short slug for the owner package
 *                            (computed via deriveNamespaceSlug).
 */
export async function executeNamespace(
  cwd: string,
  targetRelPath: string,
  owner: WorkspaceConflictOwner,
  ownershipContext: OwnershipContext,
  flowToPattern: string | undefined,
  dryRun: boolean,
  ownerNamespaceSlug: string
): Promise<{ ownerNamespacedPath: string; warning: string }> {
  const normalized = normalizePathForProcessing(targetRelPath);
  const ownerNamespacedPath = generateNamespacedPath(normalized, ownerNamespaceSlug, flowToPattern);

  if (dryRun) {
    return {
      ownerNamespacedPath,
      warning: `Would move ${normalized} (owned by ${owner.packageName}) → ${ownerNamespacedPath} to make room for incoming namespaced file.`
    };
  }

  const absTarget = join(cwd, normalized);
  const absNamespaced = join(cwd, ownerNamespacedPath);
  await ensureDir(dirname(absNamespaced));
  await fs.rename(absTarget, absNamespaced);

  await updateOwnerIndexAfterRename(
    cwd,
    owner,
    normalized,
    ownerNamespacedPath,
    ownershipContext.indexByPackage
  );

  // Update in-memory ownership map so subsequent targets in this run see the move
  ownershipContext.expandedIndexes.installedPathOwners.delete(normalized);
  ownershipContext.expandedIndexes.installedPathOwners.set(
    normalizePathForProcessing(ownerNamespacedPath),
    owner
  );

  return {
    ownerNamespacedPath,
    warning: `Moved ${normalized} (owned by ${owner.packageName}) → ${ownerNamespacedPath} (namespaced).`
  };
}

/**
 * Resolve conflicts for a batch of target paths.
 *
 * ### Namespacing strategy (default)
 *
 * This function uses a **two-pass** approach for the `namespace` strategy:
 *
 * **Pass 1 — detection:**
 *   Iterate all targets and classify each.  If ANY non-merge-flow target has a
 *   conflict (`owned-by-other` OR `exists-unowned`), mark the entire package
 *   for bulk namespacing.
 *
 * **Pass 2 — application:**
 *   - Rewrite ALL non-merge-flow target paths to their namespaced form so that
 *     the executor writes every file for this package under
 *     `<base>/<packageName>/<rest>`.
 *   - For `owned-by-other` conflicts: also physically move the existing owner's
 *     file into its own namespace and update the owner's workspace index.
 *   - For `exists-unowned` conflicts: leave the existing unowned file in place
 *     (it is the "original"); only the incoming file is namespaced (which is
 *     already the case from the bulk rewrite).
 *
 * ### Non-namespace strategies
 *   When the resolved strategy is `skip` or `overwrite` (set via
 *   `--conflicts skip|overwrite` or per-path overrides), the original
 *   per-file behaviour is preserved and no bulk namespacing occurs.
 *
 * @param cwd                  - Workspace root
 * @param targets              - Pre-computed target entries (from computeTargetEntries)
 * @param ownershipContext     - Ownership context built by buildOwnershipContext
 * @param options              - Install options
 * @param installingPackageName - Name of the package being installed (used as namespace dir)
 * @param forceOverwrite       - True when the package-level phase confirmed an overwrite
 */
export async function resolveConflictsForTargets(
  cwd: string,
  targets: TargetEntry[],
  ownershipContext: OwnershipContext,
  options: InstallOptions,
  installingPackageName: string,
  forceOverwrite: boolean = false,
  prompt?: PromptPort,
  canPrompt?: boolean
): Promise<ConflictResolutionResult> {
  const warnings: string[] = [];
  const interactive = canPrompt ?? options.interactive ?? false;
  const isDryRun = Boolean(options.dryRun);

  // -------------------------------------------------------------------------
  // Compute namespace slugs for all known packages
  // -------------------------------------------------------------------------

  // Build the set of slugs already claimed by other installed packages
  const otherPackageNames = Array.from(ownershipContext.indexByPackage.keys());
  const slugByPackageName = new Map<string, string>();
  const existingSlugs = new Set<string>();

  for (const name of otherPackageNames) {
    const slug = deriveNamespaceSlug(name, existingSlugs);
    slugByPackageName.set(name, slug);
    existingSlugs.add(slug);
  }

  // Derive the installing package's slug (avoiding collisions with other packages)
  const installingSlug = deriveNamespaceSlug(installingPackageName, existingSlugs);

  // -------------------------------------------------------------------------
  // Pass 1: Classify all targets to determine whether bulk namespacing applies
  // -------------------------------------------------------------------------

  type Classification =
    | { type: 'none' }
    | { type: 'owned-by-other'; owner: WorkspaceConflictOwner }
    | { type: 'exists-unowned' };

  const classifications: Classification[] = [];
  let shouldNamespacePackage = false;

  for (const target of targets) {
    // Merge-flow targets are never namespaced
    if (target.isMergeFlow) {
      classifications.push({ type: 'none' });
      continue;
    }

    const classification = classifyFileConflict(target.relPath, ownershipContext);

    if (classification.type === 'none') {
      classifications.push({ type: 'none' });
      continue;
    }

    if (classification.type === 'owned-by-other') {
      classifications.push({ type: 'owned-by-other', owner: classification.owner! });

      // Determine the resolution for this file to see if namespacing will apply
      const { decision } = await resolveFileConflict(
        'owned-by-other',
        target.relPath,
        classification.owner!.packageName,
        undefined,
        options,
        interactive,
        forceOverwrite,
        prompt
      );

      if (decision === 'namespace') {
        shouldNamespacePackage = true;
      }
      continue;
    }

    // exists-unowned
    const absTarget = join(cwd, normalizePathForProcessing(target.relPath));
    const fileExists = await exists(absTarget);
    if (!fileExists) {
      classifications.push({ type: 'none' });
      continue;
    }

    // Check content difference if we have content
    if (target.content !== undefined) {
      const contentDiffers = await hasContentDifference(absTarget, target.content);
      if (!contentDiffers) {
        classifications.push({ type: 'none' });
        continue;
      }
    }

    classifications.push({ type: 'exists-unowned' });

    // For exists-unowned the incoming file gets namespaced (no owner to move)
    const { decision } = await resolveFileConflict(
      'exists-unowned',
      target.relPath,
      undefined,
      undefined,
      options,
      interactive,
      forceOverwrite,
      prompt
    );

    if (decision === 'namespace') {
      shouldNamespacePackage = true;
    }
  }

  // -------------------------------------------------------------------------
  // Pass 2: Apply resolutions
  // -------------------------------------------------------------------------

  const allowedTargets: TargetEntry[] = [];
  const relocatedFiles: RelocatedFile[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const cls = classifications[i];

    // ── No conflict (or merge-flow) ──────────────────────────────────────
    if (cls.type === 'none') {
      if (shouldNamespacePackage && !target.isMergeFlow) {
        // Bulk namespacing: rewrite this non-conflicting file's path too
        const namespacedRel = generateNamespacedPath(
          target.relPath,
          installingSlug,
          target.flowToPattern
        );
        const namespacedAbs = join(cwd, namespacedRel);
        allowedTargets.push({ ...target, relPath: namespacedRel, absPath: namespacedAbs });
      } else {
        allowedTargets.push(target);
      }
      continue;
    }

    // ── owned-by-other ────────────────────────────────────────────────────
    if (cls.type === 'owned-by-other') {
      const { decision, warning } = await resolveFileConflict(
        'owned-by-other',
        target.relPath,
        cls.owner.packageName,
        undefined,
        options,
        interactive,
        forceOverwrite,
        prompt
      );
      if (warning) warnings.push(warning);

      if (decision === 'skip') continue;

      if (decision === 'namespace') {
        try {
          // Move the existing owner's file into its namespace
          const ownerSlug = slugByPackageName.get(cls.owner.packageName)
            ?? deriveNamespaceSlug(cls.owner.packageName, existingSlugs);
          const { ownerNamespacedPath, warning: nsWarn } = await executeNamespace(
            cwd,
            target.relPath,
            cls.owner,
            ownershipContext,
            target.flowToPattern,
            isDryRun,
            ownerSlug
          );
          warnings.push(nsWarn);
          relocatedFiles.push({ from: normalizePathForProcessing(target.relPath), to: ownerNamespacedPath });

          // Rewrite this incoming target to its namespaced path
          const namespacedRel = generateNamespacedPath(
            target.relPath,
            installingSlug,
            target.flowToPattern
          );
          const namespacedAbs = join(cwd, namespacedRel);
          allowedTargets.push({ ...target, relPath: namespacedRel, absPath: namespacedAbs });
        } catch (error) {
          warnings.push(`Failed to namespace ${target.relPath}: ${error}`);
          // Do not add to allowedTargets on failure
        }
        continue;
      }

      // overwrite: allow flow to write the file; clear in-memory owner to avoid re-prompting
      if (!isDryRun) {
        ownershipContext.expandedIndexes.installedPathOwners.delete(
          normalizePathForProcessing(target.relPath)
        );
      }
      if (isDryRun) {
        warnings.push(`Would overwrite ${target.relPath} (currently owned by ${cls.owner.packageName}).`);
      }
      allowedTargets.push(target);
      continue;
    }

    // ── exists-unowned ────────────────────────────────────────────────────
    if (cls.type === 'exists-unowned') {
      const { decision, warning } = await resolveFileConflict(
        'exists-unowned',
        target.relPath,
        undefined,
        undefined,
        options,
        interactive,
        forceOverwrite,
        prompt
      );
      if (warning) warnings.push(warning);

      if (decision === 'skip') continue;

      if (decision === 'namespace') {
        // Leave the existing unowned file in place; only namespace the incoming file
        const namespacedRel = generateNamespacedPath(
          target.relPath,
          installingSlug,
          target.flowToPattern
        );
        const namespacedAbs = join(cwd, namespacedRel);
        if (isDryRun) {
          warnings.push(
            `Would install ${target.relPath} as ${namespacedRel} ` +
            `(existing unowned file kept at original path).`
          );
        } else {
          warnings.push(
            `Installed as ${namespacedRel} ` +
            `(existing unowned file kept at ${target.relPath}).`
          );
        }
        allowedTargets.push({ ...target, relPath: namespacedRel, absPath: namespacedAbs });
        continue;
      }

      // overwrite or dry-run
      if (isDryRun) {
        warnings.push(`Would overwrite existing local file ${target.relPath} (content differs).`);
      }
      allowedTargets.push(target);
      continue;
    }
  }

  return {
    allowedTargets,
    warnings,
    packageWasNamespaced: shouldNamespacePackage,
    namespaceDir: shouldNamespacePackage ? installingSlug : undefined,
    relocatedFiles
  };
}
