/**
 * Package loader for dependency graph nodes.
 * Phase 2: Loads package content using existing source loaders.
 */

import type { InstallOptions, ExecutionContext } from '../../../types/index.js';
import type { PackageSource } from '../unified/context.js';
import type {
  DependencyGraph,
  ResolutionDependencyNode,
  ResolvedSource,
  LoadedPackageData,
  PackageLoaderOptions
} from './types.js';
import { getLoaderForSource } from '../sources/loader-factory.js';
import type { LoadedPackage } from '../sources/base.js';
import { logger } from '../../../utils/logger.js';
import { getCachedContentRoot } from './content-root-cache.js';

const loadCache = new Map<string, LoadedPackageData>();

/**
 * Convert ResolvedSource + declaration manifestBase to PackageSource for loaders.
 */
function toPackageSource(
  node: ResolutionDependencyNode,
  cwd: string
): PackageSource {
  const decl = node.declarations[0];
  const s = node.source;

  if (s.type === 'git') {
    return {
      type: 'git',
      packageName: decl?.name ?? node.id.displayName,
      gitUrl: s.gitUrl,
      gitRef: s.gitRef,
      gitPath: s.resourcePath ? undefined : decl?.path,
      resourcePath: s.resourcePath,
      manifestBase: decl?.base,
      contentRoot: s.contentRoot
    };
  }

  if (s.type === 'path') {
    return {
      type: 'path',
      packageName: decl?.name ?? node.id.displayName,
      localPath: s.absolutePath ?? s.contentRoot ?? '',
      sourceType: 'directory',
      manifestBase: decl?.base,
      contentRoot: s.contentRoot
    };
  }

  return {
    type: 'registry',
    packageName: s.packageName ?? decl?.name ?? node.id.displayName,
    version: s.resolvedVersion ?? decl?.version,
    manifestBase: decl?.base
  };
}

/**
 * Map loader result to LoadedPackageData.
 */
function toLoadedPackageData(loaded: LoadedPackage): LoadedPackageData {
  const baseDetection = loaded.sourceMetadata?.baseDetection;
  return {
    name: loaded.packageName,
    version: loaded.version,
    contentRoot: loaded.contentRoot,
    repoRoot: loaded.sourceMetadata?.repoPath,
    metadata: loaded.metadata ?? { name: loaded.packageName, version: loaded.version },
    manifest: loaded.metadata ?? { name: loaded.packageName, version: loaded.version },
    baseDetection: baseDetection
      ? {
          base: baseDetection.base,
          relative: baseDetection.baseRelative,
          source: baseDetection.matchType,
          pattern: baseDetection.matchedPattern,
          matchType: baseDetection.matchType
        }
      : undefined,
    formatDetection: loaded.pluginMetadata?.format
      ? { format: loaded.pluginMetadata.format }
      : undefined
  };
}

/**
 * Compute depth of a node (distance from roots).
 */
function getNodeDepth(node: ResolutionDependencyNode, graph: DependencyGraph): number {
  if (node.parents.length === 0) return 0;
  let depth = 0;
  for (const parentId of node.parents) {
    const parent = graph.nodes.get(parentId.key);
    if (parent) {
      depth = Math.max(depth, getNodeDepth(parent, graph) + 1);
    }
  }
  return depth;
}

/**
 * Group nodes by depth for parallel loading.
 */
function groupByDepth(graph: DependencyGraph): Map<number, ResolutionDependencyNode[]> {
  const groups = new Map<number, ResolutionDependencyNode[]>();
  for (const node of graph.nodes.values()) {
    const depth = getNodeDepth(node, graph);
    if (!groups.has(depth)) {
      groups.set(depth, []);
    }
    groups.get(depth)!.push(node);
  }
  return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]));
}

export class PackageLoader {
  constructor(
    private readonly execContext: ExecutionContext,
    private readonly options: PackageLoaderOptions
  ) {}

  /**
   * Load all packages in the graph.
   * Path and git nodes are loaded via source loaders; registry nodes are left for the pipeline.
   */
  async loadAll(graph: DependencyGraph): Promise<void> {
    const cacheEnabled = this.options.cacheEnabled !== false;
    const parallel = this.options.parallel !== false;
    const installOptions: InstallOptions = this.options.installOptions ?? {};

    const byDepth = groupByDepth(graph);

    for (const [, nodes] of byDepth) {
      const loadables = nodes.filter(
        (n) => (n.source.type === 'path' || n.source.type === 'git') && !n.loaded
      );

      if (parallel && loadables.length > 1) {
        await Promise.all(
          loadables.map((node) => this.loadNode(node, graph, installOptions, cacheEnabled))
        );
      } else {
        for (const node of loadables) {
          await this.loadNode(node, graph, installOptions, cacheEnabled);
        }
      }
    }
  }

  private async loadNode(
    node: ResolutionDependencyNode,
    graph: DependencyGraph,
    installOptions: InstallOptions,
    cacheEnabled: boolean
  ): Promise<void> {
    if (node.loaded) return;

    if (cacheEnabled && loadCache.has(node.id.key)) {
      node.loaded = loadCache.get(node.id.key);
      node.state = 'loaded';
      return;
    }

    if (node.source.type === 'registry') {
      node.state = 'discovered';
      return;
    }

    // Use content root from graph-builder phase if available
    if (node.source.type === 'git' && !node.source.contentRoot) {
      const cached = getCachedContentRoot(node.source);
      if (cached?.contentRoot) {
        node.source.contentRoot = cached.contentRoot;
      }
    }

    node.state = 'loading';

    try {
      const packageSource = toPackageSource(node, this.execContext.targetDir);
      const loader = getLoaderForSource(packageSource);
      const loaded = await loader.load(packageSource, installOptions, this.execContext);

      if (!loaded.metadata && loaded.pluginMetadata?.pluginType === 'marketplace') {
        logger.warn(`Skipping marketplace node ${node.id.displayName} in resolution loader`);
        node.state = 'discovered';
        return;
      }

      const data = toLoadedPackageData(loaded);
      node.loaded = data;
      node.source.contentRoot = data.contentRoot;
      node.state = 'loaded';

      if (cacheEnabled) {
        loadCache.set(node.id.key, data);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to load ${node.id.displayName}: ${errMsg}`);
      node.state = 'failed';
      // Do not rethrow: allow other packages to load; planner will skip failed nodes
    }
  }
}

/**
 * Clear the global load cache (e.g. for tests).
 */
export function clearLoadCache(): void {
  loadCache.clear();
}
