/**
 * Lockfile-First Install
 *
 * When a valid lockfile exists, bypasses the entire resolution phase
 * (manifest reading, parallel fetchers, version solver) and installs
 * packages directly via pre-populated InstallationContexts.
 *
 * The key insight: runUnifiedInstallPipeline() skips its load phase
 * when source.contentRoot is pre-set. We compute content roots
 * deterministically from lockfile data, build contexts, and call
 * the pipeline directly — never re-entering the orchestrator.
 *
 * Returns null if the lockfile is missing, stale, or any content root
 * can't be resolved, causing the caller to fall back to full resolution.
 */

import { resolve } from 'path';
import type { ExecutionContext, InstallOptions } from '../../../types/index.js';
import type { LockfilePackage } from '../../../types/lockfile.js';
import type { WaveGraph, WaveNode, WaveResolverOptions } from './types.js';
import { topologicalSort } from './wave-engine.js';
import { getLocalPackageYmlPath } from '../../../utils/paths.js';
import { parsePackageYml } from '../../../utils/package-yml.js';
import { readLockfile } from '../../../utils/lockfile-yml.js';
import { validateLockfileFreshness } from '../../../utils/lockfile-validation.js';
import { resolvePackageContentRoot } from '../local-source-resolution.js';
import { resolvePlatforms } from '../platform-resolution.js';
import { runUnifiedInstallPipeline } from '../unified/pipeline.js';
import { updateWorkspaceIndex } from './index-updater.js';
import type { InstallationContext } from '../unified/context.js';
import type { Platform } from '../../platforms.js';
import { logger } from '../../../utils/logger.js';

export interface LockfileInstallResult {
  installed: number;
  failed: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferSourceType(entry: LockfilePackage): 'git' | 'path' | 'registry' {
  if (entry.url) return 'git';
  if (entry.path) return 'path';
  return 'registry';
}

// ---------------------------------------------------------------------------
// Content root computation
// ---------------------------------------------------------------------------

/**
 * Compute the content root for a lockfile entry without running fetchers.
 * Returns null if the content root can't be found on disk.
 */
async function computeContentRoot(
  entry: LockfilePackage,
  packageName: string,
  targetDir: string,
): Promise<string | null> {
  if (entry.url) {
    // Git cache path computation requires internal knowledge; fall back to full resolution
    return null;
  }

  if (entry.path && !entry.url) {
    return resolve(targetDir, entry.path);
  }

  // Registry: cheap filesystem lookup in packages/ then registry/
  try {
    return await resolvePackageContentRoot({
      cwd: targetDir,
      packageName,
      version: entry.version ?? '',
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

/**
 * Build a pre-populated InstallationContext from a lockfile entry.
 * The pipeline's load phase will use the pre-set contentRoot directly,
 * skipping version resolution and remote fetching.
 */
function buildContextFromLockfileEntry(
  packageName: string,
  entry: LockfilePackage,
  contentRoot: string,
  platforms: Platform[],
  execContext: ExecutionContext,
  options: InstallOptions,
): InstallationContext {
  const sourceType = inferSourceType(entry);

  return {
    execution: execContext,
    targetDir: execContext.targetDir,
    source: {
      type: sourceType,
      packageName,
      version: entry.version,
      contentRoot,
      // Git fields for manifest recording
      ...(entry.url ? { gitUrl: entry.url, gitRef: entry.ref, gitPath: entry.path } : {}),
      // Path fields
      ...(entry.path && !entry.url ? { localPath: entry.path } : {}),
    },
    mode: 'install',
    options,
    platforms,
    resolvedPackages: [], // Pragmatic: let load phase run with pre-set contentRoot
    installScope: 'full',
    warnings: [],
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Lockfile-first install orchestration
// ---------------------------------------------------------------------------

/**
 * Install all packages from a valid lockfile, bypassing resolution entirely.
 * Returns null if the lockfile is missing, stale, or any content root can't be resolved.
 */
export async function installFromLockfile(
  waveOptions: WaveResolverOptions,
  execContext: ExecutionContext,
  options: InstallOptions,
): Promise<LockfileInstallResult | null> {
  const targetDir = execContext.targetDir;

  // 1. Read lockfile
  const { lockfile } = await readLockfile(targetDir);
  if (Object.keys(lockfile.packages).length === 0) {
    return null;
  }

  // 2. Read root manifest for validation
  const manifestPath = waveOptions.rootManifestPath ?? getLocalPackageYmlPath(waveOptions.workspaceRoot);
  let manifest;
  try {
    manifest = await parsePackageYml(manifestPath);
  } catch {
    return null;
  }

  // 3. Validate freshness
  const validation = validateLockfileFreshness(manifest, lockfile);
  if (!validation.fresh) {
    logger.debug(`Lockfile stale: ${validation.reason}. Falling back to full resolution.`);
    return null;
  }

  // 4. Resolve platforms once for all packages
  const platforms = await resolvePlatforms(targetDir, options.platforms);

  // 5. Compute all content roots — if any fail, fall back entirely
  const contentRoots = new Map<string, string>();
  for (const [pkgName, entry] of Object.entries(lockfile.packages)) {
    const root = await computeContentRoot(entry, pkgName, targetDir);
    if (!root) {
      logger.debug(`Content root not found for ${pkgName}. Falling back to full resolution.`);
      return null;
    }
    contentRoots.set(pkgName, root);
  }

  logger.debug(`Using lockfile for fast install (${contentRoots.size} packages, skipping resolution).`);

  // 6. Build topological order from lockfile dependency edges
  const nodes = new Map<string, WaveNode>();
  for (const [pkgName, entry] of Object.entries(lockfile.packages)) {
    const nodeId = `lockfile:${pkgName}`;
    const srcType = inferSourceType(entry);
    nodes.set(nodeId, {
      id: nodeId,
      displayName: pkgName,
      sourceType: srcType,
      source: {
        type: srcType,
        packageName: pkgName,
        resolvedVersion: entry.version,
        contentRoot: contentRoots.get(pkgName),
        absolutePath: contentRoots.get(pkgName),
        ...(entry.url ? { gitUrl: entry.url, gitRef: entry.ref, resourcePath: entry.path } : {}),
      },
      declarations: [{
        name: pkgName,
        version: entry.version,
        isDev: false,
        declaredIn: 'lockfile',
        depth: 0,
      }],
      resolvedVersion: entry.version,
      contentRoot: contentRoots.get(pkgName),
      children: (entry.dependencies ?? []).map(d => `lockfile:${d}`).filter(id => nodes.has(id) || lockfile.packages[id.slice(9)]),
      parents: [],
      wave: 0,
    });
  }

  // Build parent edges
  for (const [, node] of nodes) {
    for (const childId of node.children) {
      const child = nodes.get(childId);
      if (child) child.parents.push(node.id);
    }
  }

  const roots = [...nodes.values()].filter(n => n.parents.length === 0).map(n => n.id);
  const installOrder = topologicalSort(nodes, roots);

  // 7. Install each package in topological order
  let installed = 0;
  let failed = 0;
  let skipped = 0;

  for (const nodeId of installOrder) {
    const pkgName = nodeId.slice(9); // Remove 'lockfile:' prefix
    const entry = lockfile.packages[pkgName];
    const contentRoot = contentRoots.get(pkgName);
    if (!entry || !contentRoot) {
      skipped++;
      continue;
    }

    try {
      const ctx = buildContextFromLockfileEntry(
        pkgName, entry, contentRoot, platforms, execContext, options
      );
      const result = await runUnifiedInstallPipeline(ctx);
      if (result.success) {
        installed++;
      } else {
        failed++;
      }
    } catch (error) {
      logger.warn(`Lockfile install failed for ${pkgName}: ${error}`);
      failed++;
    }
  }

  // 8. Update workspace index with dependency graph (for index-updater compatibility)
  const graph: WaveGraph = {
    nodes,
    roots,
    installOrder,
    cycles: [],
    waveCount: 1,
    warnings: [],
  };

  try {
    await updateWorkspaceIndex(targetDir, graph);
  } catch (error) {
    logger.warn(`Failed to update workspace index after lockfile install: ${error}`);
  }

  return { installed, failed, skipped };
}
