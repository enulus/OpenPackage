/**
 * Sync Version Checker
 *
 * Central module for version constraint checking during sync/install.
 * Reads source and consumer versions, validates constraints, and
 * updates manifest ranges and workspace index versions.
 */

import { join } from 'path';
import { parsePackageYml } from '../../utils/package-yml.js';
import { getLocalPackageYmlPath } from '../../utils/paths.js';
import { arePackageNamesEquivalent, normalizePackageName } from '../../utils/package-name.js';
import { satisfiesVersion, createCaretRange } from '../../utils/version-ranges.js';
import { extractBaseVersion } from '../../utils/version-generator.js';
import { isUnversionedVersion } from '../package-versioning.js';
import { addPackageToYml } from '../package-management.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { NonInteractivePromptError } from '../ports/console-prompt.js';
import { resolveVersionMismatchInteractively } from './sync-version-resolver.js';
import type { PromptPort } from '../ports/prompt.js';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VersionCheckStatus = 'unconstrained' | 'satisfied' | 'mismatch';

export interface VersionCheckResult {
  status: VersionCheckStatus;
  sourceVersion?: string;
  manifestRange?: string;
  suggestedRange?: string;
}

export interface VersionUpdateInfo {
  oldVersion?: string;
  newVersion: string;
  oldRange?: string;
  newRange?: string;
}

export type VersionResolutionOutcome =
  | { action: 'proceed'; update: VersionUpdateInfo }
  | { action: 'skip' }
  | { action: 'none' };

// ---------------------------------------------------------------------------
// Read source package version
// ---------------------------------------------------------------------------

/**
 * Read the source package's current version from its openpackage.yml.
 * Tries root `openpackage.yml`, then `.openpackage/openpackage.yml`.
 */
export async function readSourcePackageVersion(packageRoot: string): Promise<string | undefined> {
  const candidates = [
    join(packageRoot, 'openpackage.yml'),
    join(packageRoot, '.openpackage', 'openpackage.yml'),
  ];

  for (const candidate of candidates) {
    try {
      const yml = await parsePackageYml(candidate);
      return yml.version;
    } catch {
      // File missing or parse error — try next candidate
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Read manifest range for a dependency
// ---------------------------------------------------------------------------

/**
 * Read the consumer workspace's manifest range for a specific dependency.
 * Searches both `dependencies` and `dev-dependencies`.
 * Returns `undefined` if no manifest, no dep entry, or no version field.
 */
export async function readManifestRangeForDependency(
  cwd: string,
  packageName: string,
): Promise<string | undefined> {
  const manifestPath = getLocalPackageYmlPath(cwd);

  try {
    const config = await parsePackageYml(manifestPath);
    const normalized = normalizePackageName(packageName);

    const allDeps = [
      ...(config.dependencies ?? []),
      ...(config['dev-dependencies'] ?? []),
    ];

    for (const dep of allDeps) {
      if (arePackageNamesEquivalent(dep.name, normalized)) {
        return dep.version;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Check version constraint (pure)
// ---------------------------------------------------------------------------

/**
 * Pure validation: does the source version satisfy the manifest range?
 *
 * Unconstrained when either side is undefined or unversioned.
 */
export function checkVersionConstraint(
  sourceVersion: string | undefined,
  manifestRange: string | undefined,
): VersionCheckResult {
  // Unconstrained: no source version or unversioned
  if (!sourceVersion || isUnversionedVersion(sourceVersion)) {
    return { status: 'unconstrained', sourceVersion, manifestRange };
  }

  // Unconstrained: no manifest range
  if (!manifestRange) {
    return { status: 'unconstrained', sourceVersion, manifestRange };
  }

  // Check satisfaction
  if (satisfiesVersion(sourceVersion, manifestRange)) {
    return { status: 'satisfied', sourceVersion, manifestRange };
  }

  // Mismatch — compute suggested range
  const baseVersion = extractBaseVersion(sourceVersion);
  const suggestedRange = createCaretRange(baseVersion);

  return {
    status: 'mismatch',
    sourceVersion,
    manifestRange,
    suggestedRange,
  };
}

// ---------------------------------------------------------------------------
// Resolve version mismatch (shared by sync and install)
// ---------------------------------------------------------------------------

/**
 * Resolve a version mismatch through the decision cascade:
 * 1. versionOverride → use it as new range
 * 2. force → auto-generate caret range
 * 3. interactive → prompt user
 * 4. non-interactive → throw with actionable error
 *
 * Returns the new range to use, or 'skip' if user chose to skip.
 */
export async function resolveVersionMismatch(
  packageName: string,
  check: VersionCheckResult,
  options: { versionOverride?: string; force?: boolean },
  prompt: PromptPort,
  commandName: string,
): Promise<{ action: 'update'; newRange: string } | { action: 'skip' }> {
  // 1. Version override from @<range> notation
  if (options.versionOverride) {
    return { action: 'update', newRange: options.versionOverride };
  }

  // 2. Force flag → auto-generate caret range
  if (options.force) {
    const baseVersion = extractBaseVersion(check.sourceVersion!);
    const newRange = createCaretRange(baseVersion);
    return { action: 'update', newRange };
  }

  // 3. Interactive resolution (throws NonInteractivePromptError if non-TTY)
  try {
    return await resolveVersionMismatchInteractively(packageName, check, prompt);
  } catch (error) {
    // 4. Non-interactive → actionable error
    if (error instanceof NonInteractivePromptError) {
      const suggested = check.suggestedRange ?? `^${check.sourceVersion}`;
      throw new Error(
        `Version mismatch: source '${packageName}' is at ${check.sourceVersion} ` +
        `but manifest requires ${check.manifestRange}.\n\n` +
        `To resolve, use one of:\n` +
        `  opkg ${commandName} ${packageName}@${suggested}   (update manifest range)\n` +
        `  opkg ${commandName} --force                       (auto-update to caret range)\n`
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Update manifest range
// ---------------------------------------------------------------------------

/**
 * Update the consumer's manifest with a new version range for a dependency.
 * Preserves the dependency's current location (dependencies vs dev-dependencies).
 */
export async function updateManifestRange(
  cwd: string,
  packageName: string,
  sourceVersion: string,
  newRange: string,
): Promise<void> {
  await addPackageToYml(
    cwd,
    packageName,
    sourceVersion,
    /* isDev */ false,
    /* originalVersion */ newRange,
    /* silent */ true,
  );
}

// ---------------------------------------------------------------------------
// Update index version
// ---------------------------------------------------------------------------

/**
 * Update the workspace index `version` field for a package.
 * Same read-modify-write pattern as updatePullHashesFromPipeline.
 */
export async function updateIndexVersion(
  cwd: string,
  packageName: string,
  newVersion: string,
): Promise<void> {
  try {
    const record = await readWorkspaceIndex(cwd);
    const pkg = record.index.packages?.[packageName];
    if (!pkg) return;

    pkg.version = newVersion;
    await writeWorkspaceIndex(record);
    logger.debug(`Updated workspace index version for ${packageName} to ${newVersion}`);
  } catch (error) {
    logger.warn(`Failed to update index version: ${error}`);
  }
}
