import type { InstallationContext } from '../unified/context.js';
import type { LoadedPackage } from '../sources/base.js';
import { join, relative } from 'path';
import { stat } from 'fs/promises';
import { logger } from '../../../utils/logger.js';
import { ValidationError } from '../../../utils/errors.js';

export interface ResourceScopingResult {
  /** Relative path from the base to the resource. Empty string means resource IS the base. */
  relPath: string;
  /** Whether the resource path is a directory on disk. */
  isDirectory: boolean;
  /** The computed glob pattern for file matching (e.g. "**", "dir/**", or "file.ts"). */
  pattern: string;
}

export interface ResolveResourceScopingOptions {
  /**
   * When true, throws ValidationError if the resource path does not exist on disk.
   * When false (default), a missing path is treated as a file (isDirectory = false).
   */
  strict?: boolean;
}

/**
 * Core computation: resolve a resource path relative to a package base and produce a match pattern.
 *
 * This is the single source of truth for the path-math shared by both
 * `computePathScoping()` (direct installs) and the installation planner (recursive installs).
 *
 * @returns A ResourceScopingResult, or `null` if the resource path is outside the base.
 */
export async function resolveResourceScoping(
  repoRoot: string,
  baseAbs: string,
  resourcePath: string,
  options?: ResolveResourceScopingOptions
): Promise<ResourceScopingResult | null> {
  const absResourcePath = join(repoRoot, resourcePath);
  const rawRel = relative(baseAbs, absResourcePath).replace(/\\/g, '/');

  // Resource is outside the detected base — caller decides how to handle.
  if (rawRel.startsWith('..')) {
    return null;
  }

  // Strip cosmetic "./" prefix (when resource is at the same level as base).
  const relToBaseRaw = rawRel.replace(/^\.\/?/, '');

  let isDirectory = false;
  try {
    const s = await stat(absResourcePath);
    isDirectory = s.isDirectory();
  } catch {
    if (options?.strict) {
      throw new ValidationError(
        `The specified resource path does not exist in the repository: ${resourcePath}\n\n` +
        `Please verify the path. The file or directory may have been moved, or you may have meant a different path.`
      );
    }
    // Non-strict: best-effort, default to file
  }

  // When relToBaseRaw is "" the resource IS the base directory → pattern "**"
  const prefix = relToBaseRaw.replace(/\/$/, '');
  const pattern = isDirectory ? (prefix ? `${prefix}/**` : '**') : relToBaseRaw;

  return { relPath: relToBaseRaw, isDirectory, pattern };
}

export type SpecialHandling = 'marketplace' | 'ambiguous';

export interface AmbiguousBaseMatch {
  pattern: string;
  base: string;
  startIndex: number;
}

export interface ApplyBaseDetectionResult {
  specialHandling?: SpecialHandling;
  ambiguousMatches?: AmbiguousBaseMatch[];
}

/**
 * Apply base detection results from a loader into an InstallationContext.
 *
 * This centralizes logic that used to be duplicated in strategies and the
 * pipeline load phase.
 * 
 * Includes state tracking to prevent redundant application when called
 * multiple times (e.g., in strategy preprocessing and load phase).
 */
export function applyBaseDetection(
  ctx: InstallationContext,
  loaded: LoadedPackage
): ApplyBaseDetectionResult {
  const baseDetection: any = loaded.sourceMetadata?.baseDetection;
  if (!baseDetection) {
    return {};
  }

  // Check if base detection has already been applied
  if (ctx.source._baseDetectionPerformed) {
    logger.debug('Base detection already applied, skipping redundant application');
    return {};
  }

  // If loaders already detected marketplace, surface it for orchestrator routing.
  if (loaded.pluginMetadata?.pluginType === 'marketplace') {
    ctx.source._baseDetectionPerformed = true;
    return { specialHandling: 'marketplace' };
  }

  if (baseDetection?.base) {
    ctx.detectedBase = baseDetection.base;
    // Keep source.detectedBase in sync
    ctx.source.detectedBase = baseDetection.base;
  }

  if (baseDetection?.matchedPattern && !ctx.matchedPattern) {
    ctx.matchedPattern = baseDetection.matchedPattern;
  }

  if (baseDetection?.matchType) {
    ctx.baseSource = baseDetection.matchType as any;
  }

  // Keep source contentRoot aligned with detected base (resource model).
  const effectiveContentRoot = ctx.detectedBase || loaded.contentRoot;
  if (effectiveContentRoot) {
    ctx.source.contentRoot = effectiveContentRoot;
  }

  // Compute baseRelative when repoRoot is available.
  const repoRoot = loaded.sourceMetadata?.repoPath;
  if (!ctx.baseRelative && repoRoot && ctx.detectedBase) {
    ctx.baseRelative = relative(repoRoot, ctx.detectedBase) || '.';
  } else if (!ctx.baseRelative && loaded.contentRoot && ctx.detectedBase) {
    // Fallback (less ideal if contentRoot already equals detectedBase).
    ctx.baseRelative = relative(loaded.contentRoot, ctx.detectedBase) || '.';
  }

  // Mark as performed
  ctx.source._baseDetectionPerformed = true;

  if (baseDetection?.matchType === 'marketplace') {
    return { specialHandling: 'marketplace' };
  }

  if (baseDetection?.matchType === 'ambiguous' && Array.isArray(baseDetection.ambiguousMatches)) {
    return { specialHandling: 'ambiguous', ambiguousMatches: baseDetection.ambiguousMatches };
  }

  return {};
}

/**
 * Compute resource path scoping for installs targeting a concrete resource.
 *
 * Updates ctx.matchedPattern to scope the install to the specified resourcePath.
 * 
 * Includes state tracking to prevent redundant computation when called
 * multiple times (e.g., in strategy preprocessing and load phase).
 *
 * Rules:
 * - If resource resolves to a directory, pattern becomes `<dir>/**`
 * - If resource resolves to a file, pattern becomes `<file>`
 * - If the resource cannot be stat'ed or is outside the detected base, throws ValidationError.
 */
export async function computePathScoping(
  ctx: InstallationContext,
  loaded: LoadedPackage,
  resourcePath: string
): Promise<void> {
  // Check if path scoping has already been computed
  if (ctx._pathScopingPerformed) {
    logger.debug('Path scoping already computed, skipping redundant computation');
    return;
  }

  const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot;
  if (!repoRoot) {
    return;
  }

  const baseAbs = ctx.detectedBase || loaded.contentRoot;
  if (!baseAbs) {
    return;
  }

  const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath, { strict: true });
  if (!result) {
    // Path is outside the detected package base - invalid for single-file install
    throw new ValidationError(
      `The specified resource path is outside the package base: ${resourcePath}\n\n` +
      `Please verify the path is within the package you are installing.`
    );
  }

  ctx.matchedPattern = result.pattern;

  // Mark as performed
  ctx._pathScopingPerformed = true;
}
