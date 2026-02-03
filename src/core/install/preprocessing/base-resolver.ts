import type { InstallationContext } from '../unified/context.js';
import type { LoadedPackage } from '../sources/base.js';
import { join, relative } from 'path';
import { stat } from 'fs/promises';

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
 */
export function applyBaseDetection(
  ctx: InstallationContext,
  loaded: LoadedPackage
): ApplyBaseDetectionResult {
  const baseDetection: any = loaded.sourceMetadata?.baseDetection;
  if (!baseDetection) {
    return {};
  }

  // If loaders already detected marketplace, surface it for orchestrator routing.
  if (loaded.pluginMetadata?.pluginType === 'marketplace') {
    return { specialHandling: 'marketplace' };
  }

  if (baseDetection?.base) {
    ctx.detectedBase = baseDetection.base;
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
 * Rules:
 * - If resource resolves to a directory, pattern becomes `<dir>/**`
 * - If resource resolves to a file, pattern becomes `<file>`
 * - If the resource cannot be stat'ed or is outside the detected base, do not overwrite.
 */
export async function computePathScoping(
  ctx: InstallationContext,
  loaded: LoadedPackage,
  resourcePath: string
): Promise<void> {
  const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot;
  if (!repoRoot) {
    return;
  }

  const baseAbs = ctx.detectedBase || loaded.contentRoot;
  if (!baseAbs) {
    return;
  }

  const absResourcePath = join(repoRoot, resourcePath);
  const relToBaseRaw = relative(baseAbs, absResourcePath)
    .replace(/\\/g, '/')
    .replace(/^\.\/?/, '');

  if (!relToBaseRaw || relToBaseRaw.startsWith('..')) {
    return;
  }

  let isDirectory = false;
  try {
    const s = await stat(absResourcePath);
    isDirectory = s.isDirectory();
  } catch {
    // If the resource doesn't exist or can't be stat'ed, don't overwrite matchedPattern.
    return;
  }

  ctx.matchedPattern = isDirectory ? `${relToBaseRaw.replace(/\/$/, '')}/**` : relToBaseRaw;
}
