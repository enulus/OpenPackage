/**
 * Dependency graph builder.
 * Phase 1: Recursively discovers all dependencies and builds the graph without installing.
 */

import { dirname } from 'path';
import type {
  DependencyDeclaration,
  DependencyGraph,
  DependencyCycle,
  GraphMetadata,
  ResolvedSource,
  ResolutionDependencyNode,
  GraphBuilderOptions
} from './types.js';
import { computeDependencyId } from './id-generator.js';
import { readManifestAtPath, extractDependencies, getDeclaredInDir } from './manifest-reader.js';
import { resolveDeclaredPath } from '../../../utils/path-resolution.js';
import { getLocalPackageYmlPath } from '../../../utils/paths.js';
import { parsePackageYml } from '../../../utils/package-yml.js';
import { ensureContentRoot } from './content-root-cache.js';
import { logger } from '../../../utils/logger.js';

const MAX_DEPTH_DEFAULT = 10;

/**
 * Build ResolvedSource from a declaration (path and registry without loading).
 * For git, contentRoot is set later after load.
 * pathResolutionDir: directory to resolve path against (workspace root for root deps, manifest dir for nested).
 */
function resolveSourceFromDeclaration(
  declaration: DependencyDeclaration,
  pathResolutionDir: string
): ResolvedSource {
  if (declaration.url) {
    const [gitUrl, embeddedRef] = declaration.url.includes('#')
      ? declaration.url.split('#', 2)
      : [declaration.url, undefined];
    // IMPORTANT: Do not default to 'HEAD'. Passing 'HEAD' to `git clone --branch HEAD`
    // fails on many repos and differs from single-install behavior (which uses the default branch).
    const ref = embeddedRef || declaration.ref;
    const depName = String(declaration.name ?? '');
    let resourcePath = declaration.path ?? '';
    if (depName.startsWith('gh@')) {
      const tail = depName.slice(3);
      const parts = tail.split('/').filter(Boolean);
      if (parts.length > 2 && !resourcePath) {
        resourcePath = parts.slice(2).join('/');
      }
    }
    return {
      type: 'git',
      gitUrl,
      gitRef: ref,
      resourcePath: resourcePath || undefined,
      contentRoot: undefined
    };
  }
  if (declaration.path) {
    const { absolute } = resolveDeclaredPath(declaration.path, pathResolutionDir);
    return {
      type: 'path',
      absolutePath: absolute,
      contentRoot: absolute
    };
  }
  return {
    type: 'registry',
    packageName: declaration.name,
    resolvedVersion: declaration.version,
    contentRoot: undefined
  };
}

export class DependencyGraphBuilder {
  private nodes: Map<string, ResolutionDependencyNode> = new Map();
  private visiting: Set<string> = new Set();
  private cycles: DependencyCycle[] = [];
  private warnings: string[] = [];
  private maxDepth: number;
  /** Directory used to resolve relative path deps at root level (depth 0). Set in build(). */
  private rootPathResolutionDir: string = '';

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: GraphBuilderOptions
  ) {
    this.maxDepth = options.maxDepth ?? MAX_DEPTH_DEFAULT;
  }

  /**
   * Build complete dependency graph from root manifest.
   * Uses workspace .openpackage/openpackage.yml unless options.rootManifestPath is set.
   * When options.includeRoot is true, the root manifest package itself is included as
   * the first node in the graph (installed before its dependencies).
   */
  async build(): Promise<DependencyGraph> {
    const manifestPath = this.options.rootManifestPath ?? getLocalPackageYmlPath(this.workspaceRoot);
    this.rootPathResolutionDir = this.options.rootManifestPath
      ? dirname(manifestPath)
      : this.workspaceRoot;

    let manifest;
    try {
      manifest = await parsePackageYml(manifestPath);
    } catch (error) {
      logger.warn(`Could not read manifest at ${manifestPath}: ${error}`);
      return this.emptyGraph();
    }

    const roots: import('./types.js').DependencyId[] = [];
    let rootPackageNode: ResolutionDependencyNode | null = null;

    if (this.options.includeRoot && this.options.rootManifestPath) {
      rootPackageNode = await this.createRootPackageNode(manifest, manifestPath);
      if (rootPackageNode) {
        roots.push(rootPackageNode.id);
      }
    }

    const rootDeclarations = extractDependencies(
      manifest,
      manifestPath,
      0,
      this.options.includeDev ?? true
    );

    for (const decl of rootDeclarations) {
      if (decl.depth >= this.maxDepth) {
        this.warnings.push(`Skipping dependency ${decl.name}: max depth ${this.maxDepth} reached`);
        continue;
      }
      const node = await this.discoverNode(decl);
      if (node) {
        if (rootPackageNode) {
          rootPackageNode.children.push(node.id);
          node.parents.push(rootPackageNode.id);
        } else {
          roots.push(node.id);
        }
      }
    }

    const installationOrder = this.computeInstallationOrder(roots);
    const maxDepth = this.computeMaxDepth();

    return {
      nodes: this.nodes,
      roots,
      installationOrder,
      cycles: this.cycles,
      metadata: {
        builtAt: new Date(),
        workspaceRoot: this.workspaceRoot,
        nodeCount: this.nodes.size,
        maxDepth,
        warnings: this.warnings
      }
    };
  }

  private async createRootPackageNode(
    manifest: import('../../../types/index.js').PackageYml,
    manifestPath: string
  ): Promise<ResolutionDependencyNode | null> {
    const contentRoot = dirname(manifestPath);
    const packageName = manifest.name || 'root';

    const id: import('./types.js').DependencyId = {
      key: `root:${contentRoot}`,
      displayName: packageName,
      sourceType: 'path'
    };

    const source: ResolvedSource = {
      type: 'path',
      absolutePath: contentRoot,
      contentRoot,
      manifestPath
    };

    const node: ResolutionDependencyNode = {
      id,
      declarations: [],
      source,
      children: [],
      parents: [],
      state: 'discovered'
    };

    this.nodes.set(id.key, node);
    return node;
  }

  private emptyGraph(): DependencyGraph {
    return {
      nodes: new Map(),
      roots: [],
      installationOrder: [],
      cycles: [],
      metadata: {
        builtAt: new Date(),
        workspaceRoot: this.workspaceRoot,
        nodeCount: 0,
        maxDepth: 0,
        warnings: this.warnings
      }
    };
  }

  private async discoverNode(
    declaration: DependencyDeclaration
  ): Promise<ResolutionDependencyNode | null> {
    const declaredInDir = getDeclaredInDir(declaration.declaredIn);
    const pathResolutionDir = declaration.depth === 0 ? this.rootPathResolutionDir : declaredInDir;
    const id = computeDependencyId(declaration, pathResolutionDir);

    if (this.visiting.has(id.key)) {
      this.recordCycle(id);
      return null;
    }

    const existing = this.nodes.get(id.key);
    if (existing) {
      existing.declarations.push(declaration);
      return existing;
    }

    this.visiting.add(id.key);

    const source = resolveSourceFromDeclaration(declaration, pathResolutionDir);

    const node: ResolutionDependencyNode = {
      id,
      declarations: [declaration],
      source,
      children: [],
      parents: [],
      state: 'discovering'
    };
    this.nodes.set(id.key, node);

    let contentRoot: string | undefined = source.contentRoot ?? source.absolutePath;

    if (source.type === 'git' && !contentRoot) {
      const result = await ensureContentRoot(source, { skipCache: this.options.skipCache });
      if (result.isMarketplace) {
        this.warnings.push(`Dependency '${declaration.name}' is a marketplace; skipping nested deps`);
      } else if (result.contentRoot) {
        contentRoot = result.contentRoot;
        node.source.contentRoot = contentRoot;
      } else {
        logger.warn(`Failed to load git dependency '${declaration.name}'`);
        this.warnings.push(`Failed to load ${declaration.name}`);
      }
    }

    if (contentRoot && declaration.depth < this.maxDepth) {
      const manifest = await readManifestAtPath(contentRoot);
      if (manifest) {
        const childDeclarations = extractDependencies(
          manifest,
          contentRoot + '/openpackage.yml',
          declaration.depth + 1,
          false
        );
        for (const childDecl of childDeclarations) {
          if (childDecl.depth >= this.maxDepth) continue;
          const childNode = await this.discoverNode(childDecl);
          if (childNode) {
            node.children.push(childNode.id);
            childNode.parents.push(id);
          }
        }
      }
    }

    this.visiting.delete(id.key);
    node.state = 'discovered';
    return node;
  }

  private recordCycle(id: import('./types.js').DependencyId): void {
    const cycleNodes = Array.from(this.visiting).map((key) => {
      const n = this.nodes.get(key);
      return n?.id;
    }).filter(Boolean) as import('./types.js').DependencyId[];
    const startIdx = cycleNodes.findIndex((x) => x.key === id.key);
    const cycle = startIdx >= 0 ? cycleNodes.slice(startIdx).concat([id]) : [id];
    this.cycles.push({ nodes: cycle, resolution: 'skipped' });
    const cycleNames = cycle.map((c) => c.displayName).join(' → ');
    this.warnings.push(`Circular dependency detected: ${cycleNames}`);
  }

  private computeInstallationOrder(
    roots: import('./types.js').DependencyId[]
  ): import('./types.js').DependencyId[] {
    const order: import('./types.js').DependencyId[] = [];
    const visited = new Set<string>();

    const visit = (nodeId: import('./types.js').DependencyId) => {
      if (visited.has(nodeId.key)) return;
      visited.add(nodeId.key);
      const node = this.nodes.get(nodeId.key);
      if (!node) return;
      for (const childId of node.children) {
        visit(childId);
      }
      order.push(nodeId);
    };

    for (const root of roots) {
      visit(root);
    }
    return order;
  }

  private computeMaxDepth(): number {
    let max = 0;
    const depthMap = new Map<string, number>();

    const getDepth = (key: string): number => {
      const cached = depthMap.get(key);
      if (cached !== undefined) return cached;
      const node = this.nodes.get(key);
      if (!node) return 0;
      let d = 0;
      for (const childId of node.children) {
        d = Math.max(d, getDepth(childId.key) + 1);
      }
      depthMap.set(key, d);
      return d;
    };

    for (const key of this.nodes.keys()) {
      max = Math.max(max, getDepth(key));
    }
    return max;
  }
}
