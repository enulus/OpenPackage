import { dirname } from 'path';
import type {
  WaveNode,
  WaveGraph,
  WaveResult,
  WaveResolverOptions,
  DependencyDeclaration,
  FetcherOptions
} from './types.js';
import { WaveVersionSolver } from './version-solver.js';
import { createFetcher, computeWaveId, resolveSourceFromDeclaration } from './fetcher.js';
import { readManifestAtPath, extractDependencies } from './manifest-reader.js';
import { getLocalPackageYmlPath } from '../../../utils/paths.js';
import { parsePackageYml } from '../../../utils/package-yml.js';
import { resolveNamedDependency } from '../../source-resolution/resolve-named-dependency.js';
import { logger } from '../../../utils/logger.js';

const DEFAULT_MAX_NODES = 10_000;

/**
 * Resolve the full dependency graph starting from a root manifest using
 * breadth-first wave expansion.
 *
 * The algorithm reads the root manifest, enqueues its direct dependencies,
 * then processes them in breadth-first waves -- fetching metadata in parallel
 * within each wave, discovering new dependencies, and repeating until the
 * queue is empty.
 *
 * This function only fetches metadata and discovers the dependency graph.
 * It does NOT load or install packages; that responsibility belongs to the
 * installation pipeline.
 */
export async function resolveWave(options: WaveResolverOptions): Promise<WaveResult> {
  const {
    workspaceRoot,
    rootManifestPath,
    includeDev = true,
    includeRoot = false,
    force = false,
    skipCache = false,
    resolutionMode = 'default',
    maxNodes = DEFAULT_MAX_NODES,
    onConflict,
    profile,
    apiKey,
    output
  } = options;
  
  const spinner = output?.spinner();

  // 1. Read root manifest
  const manifestPath = rootManifestPath ?? getLocalPackageYmlPath(workspaceRoot);
  const rootPathResolutionDir = rootManifestPath ? dirname(manifestPath) : workspaceRoot;

  let manifest;
  try {
    manifest = await parsePackageYml(manifestPath);
  } catch (error) {
    logger.warn(`Could not read manifest at ${manifestPath}: ${error}`);
    return emptyResult();
  }

  // 2. Initialize state
  const resolved = new Map<string, WaveNode>();
  const queue: Array<{ decl: DependencyDeclaration; parentId: string | null; pathResolutionDir: string }> = [];
  const visiting = new Set<string>();
  const cycles: string[][] = [];
  const warnings: string[] = [];
  const roots: string[] = [];
  const versionSolver = new WaveVersionSolver();
  let waveNumber = 0;

  // 2a. Optionally include root package as a node
  if (includeRoot && rootManifestPath) {
    const contentRoot = dirname(manifestPath);
    const packageName = manifest.name || 'root';
    const rootId = `root:${contentRoot}`;
    const rootNode: WaveNode = {
      id: rootId,
      displayName: packageName,
      sourceType: 'path',
      source: { type: 'path', absolutePath: contentRoot, contentRoot, manifestPath },
      declarations: [],
      contentRoot,
      metadata: manifest,
      children: [],
      parents: [],
      wave: 0,
      resolvedVersion: manifest.version
    };
    resolved.set(rootId, rootNode);
    roots.push(rootId);
  }

  // 3. Extract root dependencies and enqueue
  const rootDeclarations = extractDependencies(manifest, manifestPath, 0, includeDev);

  for (const decl of rootDeclarations) {
    queue.push({
      decl,
      parentId: includeRoot && rootManifestPath ? roots[0] : null,
      pathResolutionDir: rootPathResolutionDir
    });
  }

  // 4. Fetcher options template
  const baseFetcherOptions: Omit<FetcherOptions, 'depth'> = {
    workspaceRoot,
    resolutionMode,
    skipCache,
    profile,
    apiKey
  };

  // 5. Wave loop
  spinner?.start('Resolving dependencies');

  try {
  while (queue.length > 0) {
    waveNumber++;

    // Dequeue all items for this wave
    const currentWave = queue.splice(0, queue.length);

    // Deduplicate and prepare fetch tasks
    const toFetch: Array<{
      decl: DependencyDeclaration;
      id: string;
      displayName: string;
      sourceType: 'registry' | 'path' | 'git';
      parentId: string | null;
      pathResolutionDir: string;
    }> = [];

    for (const item of currentWave) {
      const { decl, parentId, pathResolutionDir } = item;
      const declaredInDir = decl.depth === 0 ? pathResolutionDir : dirname(decl.declaredIn);

      // For registry-only declarations, prefer local mutable copies over registry.
      // Skip registry here — the fetcher handles registry resolution separately.
      let effectiveDecl = decl;
      if (!decl.base && !decl.url) {
        try {
          const resolved = await resolveNamedDependency(decl.name, workspaceRoot, {
            version: decl.version,
            skipRegistry: true
          });
          effectiveDecl = { ...decl, base: resolved.absolutePath };
        } catch {
          // Not found locally — continue with registry declaration
        }
      }

      const computed = computeWaveId(effectiveDecl, declaredInDir);

      // Cycle detection
      if (visiting.has(computed.id)) {
        const cycleNodes = [...visiting, computed.id];
        const startIdx = cycleNodes.indexOf(computed.id);
        const cycle = startIdx >= 0 ? cycleNodes.slice(startIdx) : [computed.id];
        cycles.push(cycle);
        warnings.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
        continue;
      }

      // Already resolved -- just add the parent edge and declaration
      if (resolved.has(computed.id)) {
        const existing = resolved.get(computed.id)!;
        existing.declarations.push(effectiveDecl);
        if (parentId) {
          if (!existing.parents.includes(parentId)) {
            existing.parents.push(parentId);
          }
          const parentNode = resolved.get(parentId);
          if (parentNode && !parentNode.children.includes(computed.id)) {
            parentNode.children.push(computed.id);
          }
        }
        // Add version constraint for the new declaration
        if (computed.sourceType === 'registry' && effectiveDecl.version) {
          versionSolver.addConstraint(effectiveDecl.name, effectiveDecl.version, effectiveDecl.declaredIn);
        }
        // Already resolved -- no need to fetch or add to roots again
        continue;
      }

      toFetch.push({
        decl: effectiveDecl,
        id: computed.id,
        displayName: computed.displayName,
        sourceType: computed.sourceType,
        parentId,
        pathResolutionDir: declaredInDir
      });
    }

    if (toFetch.length === 0) continue;

    // Mark as visiting
    for (const item of toFetch) {
      visiting.add(item.id);
    }

    // Safety valve
    if (resolved.size + toFetch.length > maxNodes) {
      throw new Error(
        `Wave resolver safety valve: resolved ${resolved.size} nodes with ${toFetch.length} pending. ` +
        `Maximum is ${maxNodes}. This likely indicates a bug or pathological dependency graph.`
      );
    }

    // Parallel fetch all in this wave
    spinner?.message(`Resolving dependencies (wave ${waveNumber}, ${resolved.size} resolved)`);
    
    const fetchResults = await Promise.all(
      toFetch.map(async (item) => {
        const fetcher = createFetcher(item.decl);
        try {
          const result = await fetcher.fetch(item.decl, item.pathResolutionDir, {
            ...baseFetcherOptions,
            depth: item.decl.depth
          });
          return { item, result, error: null as Error | null };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.warn(`Failed to fetch ${item.displayName}: ${err.message}`);
          warnings.push(`Failed to fetch ${item.displayName}: ${err.message}`);
          return { item, result: null, error: err };
        }
      })
    );

    // Process fetch results
    for (const { item, result, error } of fetchResults) {
      visiting.delete(item.id);

      if (error || !result) continue;

      if (item.sourceType === 'path' && !result.contentRoot && !result.metadata) {
        const declaredPath = item.decl.base ?? item.decl.path ?? item.displayName;
        warnings.push(`Dependency '${item.displayName}' path not found: ${declaredPath} — skipping`);
        logger.warn(`Skipping missing path dependency '${item.displayName}': ${declaredPath}`);
        continue;
      }

      // Create WaveNode
      const node: WaveNode = {
        id: item.id,
        displayName: item.displayName,
        sourceType: item.sourceType,
        source: result.source,
        declarations: [item.decl],
        resolvedVersion: result.version,
        contentRoot: result.contentRoot,
        repoRoot: result.repoRoot,
        metadata: result.metadata,
        children: [],
        parents: item.parentId ? [item.parentId] : [],
        wave: waveNumber,
        isMarketplace: result.isMarketplace,
        loaded: result.loaded
      };
      resolved.set(item.id, node);

      // Wire parent->child edge
      if (item.parentId) {
        const parentNode = resolved.get(item.parentId);
        if (parentNode && !parentNode.children.includes(item.id)) {
          parentNode.children.push(item.id);
        }
      } else {
        // This is a root-level dep (no includeRoot parent)
        if (!roots.includes(item.id)) {
          roots.push(item.id);
        }
      }

      // Track version for solver
      if (item.sourceType === 'registry') {
        if (result.version) {
          versionSolver.addAvailableVersion(item.decl.name, result.version);
        }
        versionSolver.addConstraint(item.decl.name, item.decl.version, item.decl.declaredIn);
      }

      // Skip child dep enumeration for marketplace deps
      if (result.isMarketplace) {
        warnings.push(`Dependency '${item.displayName}' is a marketplace; skipping nested deps`);
        continue;
      }

      // Enqueue child dependencies
      const childDeclaredInDir = result.contentRoot ?? item.pathResolutionDir;
      for (const childDecl of result.childDependencies) {
        const childComputed = computeWaveId(childDecl, childDeclaredInDir);
        if (!resolved.has(childComputed.id)) {
          queue.push({
            decl: childDecl,
            parentId: item.id,
            pathResolutionDir: childDeclaredInDir
          });
        } else {
          // Already resolved -- wire edge
          const childId = childComputed.id;
          if (!node.children.includes(childId)) {
            node.children.push(childId);
          }
          const childNode = resolved.get(childId)!;
          if (!childNode.parents.includes(item.id)) {
            childNode.parents.push(item.id);
          }
          // Still add constraint for the existing node
          if (childDecl.version && !childDecl.url && !childDecl.base) {
            versionSolver.addConstraint(childDecl.name, childDecl.version, childDecl.declaredIn);
          }
        }
      }
    }
  }

  // 6. Run version solver
  const versionSolution = await versionSolver.solve({ force, onConflict });

  // Apply solved versions to registry nodes
  for (const [packageName, version] of versionSolution.resolved) {
    for (const node of resolved.values()) {
      if (node.sourceType === 'registry' && node.source.packageName === packageName) {
        node.resolvedVersion = version;
        node.source.resolvedVersion = version;
      }
    }
  }

  // 7. Topological sort (leaves first)
  const installOrder = topologicalSort(resolved, roots);

  const graph: WaveGraph = {
    nodes: resolved,
    roots,
    installOrder,
    cycles,
    waveCount: waveNumber,
    warnings
  };

  spinner?.stop(`Resolved ${resolved.size} dependencies in ${waveNumber} wave${waveNumber !== 1 ? 's' : ''}`);

  logger.info(`Wave resolution complete: ${resolved.size} packages in ${waveNumber} waves`);

  return { graph, versionSolution };

  } catch (error) {
    spinner?.stop();
    throw error;
  }
}

/**
 * Produce a topological ordering of the dependency graph with leaves first.
 * Uses a post-order DFS so that children appear before their parents in the
 * resulting array -- the correct installation order when dependencies must be
 * installed before dependents.
 */
export function topologicalSort(nodes: Map<string, WaveNode>, roots: string[]): string[] {
  const order: string[] = [];
  const visited = new Set<string>();

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodes.get(nodeId);
    if (!node) return;
    // Visit children first (leaves end up earlier in order)
    for (const childId of node.children) {
      visit(childId);
    }
    order.push(nodeId);
  };

  for (const rootId of roots) {
    visit(rootId);
  }

  // Also visit any disconnected nodes (shouldn't happen, but safety)
  for (const nodeId of nodes.keys()) {
    visit(nodeId);
  }

  return order;
}

/**
 * Return an empty WaveResult for cases where the root manifest cannot be read
 * or has no dependencies.
 */
function emptyResult(): WaveResult {
  return {
    graph: {
      nodes: new Map(),
      roots: [],
      installOrder: [],
      cycles: [],
      waveCount: 0,
      warnings: []
    },
    versionSolution: {
      resolved: new Map(),
      conflicts: []
    }
  };
}
