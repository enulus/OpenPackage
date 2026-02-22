/**
 * Installation planner: builds InstallationContexts from loaded graph nodes.
 * Phase 3: Creates installation plan in topological order.
 */

import type { PackageSource } from '../unified/context.js';
import type { ExecutionContext } from '../../../types/index.js';
import type { ResolvedPackage } from '../../dependency-resolver/types.js';
import type { InstallationContext } from '../unified/context.js';
import type {
  DependencyGraph,
  ResolutionDependencyNode,
  InstallationPlan,
  SkippedPackage,
  InstallationPlannerOptions
} from './types.js';
import { getInstalledPackageVersion } from '../../openpackage.js';
import { join, relative } from 'node:path';
import { existsSync, statSync } from 'node:fs';

/**
 * Map resolution source type to ResolvedPackage source.
 */
function mapSourceType(
  sourceType: 'registry' | 'path' | 'git'
): 'local' | 'remote' | 'path' | 'git' {
  if (sourceType === 'registry') return 'local';
  return sourceType;
}

/**
 * Build PackageSource from a resolution node.
 */
function buildPackageSource(node: ResolutionDependencyNode): PackageSource {
  const decl = node.declarations[0];
  const s = node.source;

  if (s.type === 'git') {
    return {
      type: 'git',
      packageName: node.loaded?.name ?? decl?.name ?? node.id.displayName,
      gitUrl: s.gitUrl,
      gitRef: s.gitRef,
      gitPath: s.resourcePath ? undefined : decl?.path,
      resourcePath: s.resourcePath,
      manifestBase: decl?.base,
      contentRoot: s.contentRoot ?? node.loaded?.contentRoot
    };
  }

  if (s.type === 'path') {
    return {
      type: 'path',
      packageName: node.loaded?.name ?? decl?.name ?? node.id.displayName,
      localPath: s.absolutePath ?? s.contentRoot ?? '',
      sourceType: 'directory',
      manifestBase: decl?.base,
      contentRoot: s.contentRoot ?? node.loaded?.contentRoot
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
 * Build ResolvedPackage (root entry) from loaded data.
 */
function buildResolvedPackage(node: ResolutionDependencyNode): ResolvedPackage {
  const loaded = node.loaded!;
  return {
    name: loaded.name,
    version: loaded.version,
    pkg: {
      metadata: loaded.metadata,
      files: [],
      _format: loaded.formatDetection?.format
    },
    isRoot: true,
    source: mapSourceType(node.id.sourceType),
    contentRoot: loaded.contentRoot
  };
}

export class InstallationPlanner {
  constructor(
    private readonly execContext: ExecutionContext,
    private readonly options: InstallationPlannerOptions
  ) {}

  /**
   * Create installation plan from loaded graph.
   * Nodes without .loaded (e.g. registry not pre-loaded) get a minimal context for the pipeline to load/resolve.
   */
  async createPlan(graph: DependencyGraph): Promise<InstallationPlan> {
    const contexts: InstallationContext[] = [];
    const skipped: SkippedPackage[] = [];
    const force = this.options.force ?? false;

    for (const id of graph.installationOrder) {
      const node = graph.nodes.get(id.key);
      if (!node) continue;

      if (node.state === 'failed') {
        skipped.push({ id: node.id, reason: 'failed' });
        continue;
      }

      if (!node.loaded) {
        skipped.push({ id: node.id, reason: 'not-loaded' });
        continue;
      }

      const alreadyInstalled = await getInstalledPackageVersion(node.loaded.name, this.execContext.targetDir);
      if (alreadyInstalled && !force) {
        skipped.push({ id: node.id, reason: 'already-installed' });
        continue;
      }

      const context = this.buildContext(node);
      contexts.push(context);
      node.installContext = context;
    }

    return {
      contexts,
      skipped,
      graph,
      estimatedOperations: contexts.length
    };
  }

  /**
   * Build InstallationContext for the unified pipeline.
   * Caller must ensure node.loaded is set. Pre-populates source and resolvedPackages so pipeline skips load and resolve.
   */
  buildContext(node: ResolutionDependencyNode): InstallationContext {
    const source = buildPackageSource(node);
    const platforms = this.options.platforms ?? [];
    const installOptions = this.options.installOptions ?? {};
    const resolvedPackage = buildResolvedPackage(node);
    const ctx: InstallationContext = {
      execution: this.execContext,
      targetDir: this.execContext.targetDir,
      source,
      mode: 'install',
      options: installOptions as InstallationContext['options'],
      platforms,
      resolvedPackages: [resolvedPackage],
      warnings: [],
      errors: [],
      detectedBase: node.loaded!.baseDetection?.base,
      baseRelative: node.loaded!.baseDetection?.relative,
      baseSource: node.loaded!.baseDetection?.source as InstallationContext['baseSource'],
      matchedPattern: node.loaded!.baseDetection?.pattern
    };

    // Phase: resource scoping for recursive installs.
    // In recursive mode we pre-populate ctx.resolvedPackages/contentRoot, so loadPackagePhase is skipped,
    // and computePathScoping() would never run. If a concrete resourcePath is present, scope matchedPattern here.
    const resourcePath = (ctx.source as any).resourcePath as string | undefined;
    const repoRoot = node.loaded?.repoRoot;
    const baseAbs = ctx.detectedBase ?? ctx.source.contentRoot;
    if (resourcePath && repoRoot && baseAbs) {
      try {
        const absResourcePath = join(repoRoot, resourcePath);
        const relToBaseRaw = relative(baseAbs, absResourcePath)
          .replace(/\\/g, '/')
          .replace(/^\.\/?/, '');
        if (relToBaseRaw && !relToBaseRaw.startsWith('..')) {
          let isDirectory = false;
          try {
            if (existsSync(absResourcePath)) {
              const s = statSync(absResourcePath);
              isDirectory = s.isDirectory();
            }
          } catch {
            // best-effort only
          }
          
          const specificPattern = isDirectory ? `${relToBaseRaw.replace(/\/$/, '')}/**` : relToBaseRaw;
          
          // Phase 4: If we have a broad pattern from base detection (e.g. "skills/**/*"),
          // but we are installing a specific resource (e.g. "skills/react-best-practices"),
          // we must narrow the pattern to ensure only the requested resource is installed.
          if (!ctx.matchedPattern || (ctx.matchedPattern.includes('**') && specificPattern.length > ctx.matchedPattern.replace('/**', '').length)) {
            ctx.matchedPattern = specificPattern;
          }
        }
      } catch {
        // best-effort only
      }
    }

    return ctx;
  }
}
