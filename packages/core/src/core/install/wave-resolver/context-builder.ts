/**
 * Converts a WaveGraph into InstallationContexts for the unified pipeline.
 * Iterates in topological order, skipping already-installed packages (unless force).
 * Pre-populates resolvedPackages so the pipeline skips load and resolve phases
 * where possible.
 */

import type { PackageSource, InstallationContext } from '../unified/context.js';
import type { ExecutionContext, InstallOptions } from '../../../types/index.js';
import type { ResolvedPackage } from '../../dependency-resolver/types.js';
import type { Platform } from '../../platforms.js';
import type { WaveGraph, WaveNode } from './types.js';
import { getInstalledPackageVersion } from '../../openpackage.js';
import { resolveResourceScoping } from '../preprocessing/base-resolver.js';
import { logger } from '../../../utils/logger.js';

/**
 * Options for building installation contexts from a wave graph.
 */
export interface BuildContextOptions {
  /** Resolved platforms (shared across all packages) */
  platforms: Platform[];
  /** Install options from CLI */
  installOptions: InstallOptions;
  /** Force reinstall even if already installed */
  force?: boolean;
}

/**
 * Map resolution source type to ResolvedPackage source field.
 */
function mapSourceType(
  sourceType: 'registry' | 'path' | 'git'
): 'local' | 'remote' | 'path' | 'git' {
  if (sourceType === 'registry') return 'local';
  return sourceType;
}

/**
 * Build a PackageSource from a WaveNode for the unified pipeline.
 */
function buildPackageSource(node: WaveNode): PackageSource {
  const decl = node.declarations[0];
  const s = node.source;

  if (s.type === 'git') {
    return {
      type: 'git',
      packageName: node.metadata?.name ?? decl?.name ?? node.displayName,
      gitUrl: s.gitUrl,
      gitRef: s.gitRef,
      gitPath: s.resourcePath ? undefined : decl?.path,
      resourcePath: s.resourcePath,
      manifestBase: decl?.base,
      contentRoot: s.contentRoot ?? node.contentRoot
    };
  }

  if (s.type === 'path') {
    return {
      type: 'path',
      packageName: node.metadata?.name ?? decl?.name ?? node.displayName,
      localPath: s.absolutePath ?? s.contentRoot ?? '',
      sourceType: 'directory',
      manifestBase: decl?.base,
      contentRoot: s.contentRoot ?? node.contentRoot
    };
  }

  // Registry
  return {
    type: 'registry',
    packageName: s.packageName ?? decl?.name ?? node.displayName,
    version: node.resolvedVersion ?? s.resolvedVersion ?? decl?.version,
    manifestBase: decl?.base
  };
}

/**
 * Build a ResolvedPackage from a WaveNode.
 * Returns null if the node has no metadata (registry nodes that need pipeline loading).
 */
function buildResolvedPackage(node: WaveNode): ResolvedPackage | null {
  if (!node.metadata) return null;

  return {
    name: node.metadata.name ?? node.displayName,
    version: node.resolvedVersion ?? node.metadata.version ?? 'unknown',
    pkg: {
      metadata: node.metadata,
      files: [],
      _format: node.loaded?.formatDetection?.format
    },
    isRoot: true,
    source: mapSourceType(node.sourceType),
    contentRoot: node.contentRoot
  };
}

/**
 * Convert a WaveGraph into InstallationContexts for the unified pipeline.
 *
 * Iterates in topological install order (leaves first). For each node:
 * - Skips marketplace nodes
 * - Skips already-installed packages (unless force)
 * - Builds a PackageSource and optional ResolvedPackage
 *
 * @returns contexts to install and a list of skipped nodes with reasons
 */
export async function buildInstallContexts(
  graph: WaveGraph,
  execContext: ExecutionContext,
  options: BuildContextOptions
): Promise<{ contexts: InstallationContext[]; skipped: Array<{ id: string; reason: string }> }> {
  const contexts: InstallationContext[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const force = options.force ?? false;

  for (const nodeId of graph.installOrder) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;

    // Skip marketplace nodes
    if (node.isMarketplace) {
      skipped.push({ id: nodeId, reason: 'marketplace' });
      continue;
    }

    // Determine package name for installed-check
    const packageName = node.source.packageName ?? node.metadata?.name ?? node.displayName;

    // Check already-installed
    if (!force) {
      const installedVersion = await getInstalledPackageVersion(packageName, execContext.targetDir);
      if (installedVersion) {
        skipped.push({ id: nodeId, reason: 'already-installed' });
        continue;
      }
    }

    const source = buildPackageSource(node);
    const resolvedPackage = buildResolvedPackage(node);

    const ctx: InstallationContext = {
      execution: execContext,
      targetDir: execContext.targetDir,
      source,
      mode: 'install',
      options: options.installOptions as InstallationContext['options'],
      platforms: options.platforms,
      resolvedPackages: resolvedPackage ? [resolvedPackage] : [],
      warnings: [],
      errors: [],
      detectedBase: node.loaded?.baseDetection?.base,
      baseRelative: node.loaded?.baseDetection?.relative,
      baseSource: node.loaded?.baseDetection?.source as InstallationContext['baseSource'],
      matchedPattern: node.loaded?.baseDetection?.pattern
    };

    // Resource scoping for git deps with resourcePath
    const resourcePath = source.resourcePath;
    const repoRoot = node.repoRoot;
    const baseAbs = ctx.detectedBase ?? source.contentRoot;
    if (resourcePath && repoRoot && baseAbs) {
      try {
        const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);
        if (result) {
          if (
            !ctx.matchedPattern ||
            (ctx.matchedPattern.includes('**') &&
              result.pattern.length > ctx.matchedPattern.replace('/**', '').length)
          ) {
            ctx.matchedPattern = result.pattern;
          }
        }
      } catch {
        // best-effort
      }
    }

    contexts.push(ctx);
  }

  logger.info(`Wave context builder: ${contexts.length} to install, ${skipped.length} skipped`);
  return { contexts, skipped };
}
