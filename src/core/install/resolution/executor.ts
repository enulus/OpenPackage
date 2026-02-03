/**
 * Dependency resolution executor.
 * Orchestrates discovery, loading, planning, and execution.
 */

import type { CommandResult } from '../../../types/index.js';
import { runUnifiedInstallPipeline } from '../unified/pipeline.js';
import { DependencyGraphBuilder } from './graph-builder.js';
import { PackageLoader } from './package-loader.js';
import { InstallationPlanner } from './installation-planner.js';
import type {
  DependencyGraph,
  ExecutorOptions,
  ExecutionResult,
  PackageResult,
  ExecutionSummary
} from './types.js';
import { logger } from '../../../utils/logger.js';

export class DependencyResolutionExecutor {
  private graphBuilder: DependencyGraphBuilder;
  private packageLoader: PackageLoader;
  private planner: InstallationPlanner;

  constructor(
    private readonly cwd: string,
    private readonly options: ExecutorOptions
  ) {
    this.graphBuilder = new DependencyGraphBuilder(cwd, options.graphOptions);
    this.packageLoader = new PackageLoader(options.loaderOptions);
    this.planner = new InstallationPlanner(options.plannerOptions);
  }

  /**
   * Execute full dependency resolution and installation.
   */
  async execute(): Promise<ExecutionResult> {
    const results: PackageResult[] = [];
    let graph: DependencyGraph | undefined;

    try {
      logger.info('Discovering dependencies');
      graph = await this.graphBuilder.build();

      if (graph.cycles.length > 0) {
        for (const cycle of graph.cycles) {
          const names = cycle.nodes.map((n) => n.displayName).join(' -> ');
          logger.warn(`Circular dependency: ${names}`);
        }
      }

      logger.info(`Found ${graph.metadata.nodeCount} packages (max depth: ${graph.metadata.maxDepth})`);

      logger.info('Loading packages');
      await this.packageLoader.loadAll(graph);

      const loadedCount = this.countLoadedNodes(graph);
      logger.info(`Loaded ${loadedCount}/${graph.metadata.nodeCount} packages`);

      logger.info('Planning installation');
      const plan = await this.planner.createPlan(graph);

      if (plan.skipped.length > 0) {
        for (const s of plan.skipped) {
          logger.debug(`Skipped ${s.id.displayName}: ${s.reason}`);
        }
      }

      logger.info(`${plan.contexts.length} packages to install, ${plan.skipped.length} skipped`);

      if (this.options.dryRun) {
        return this.createDryRunResult(plan, graph);
      }

      logger.info('Installing packages');
      for (const ctx of plan.contexts) {
        const node = this.findNodeForContext(ctx, graph);
        if (!node) continue;

        try {
          node.state = 'installing';
          const result: CommandResult = await runUnifiedInstallPipeline(ctx);

          if (result.success) {
            node.state = 'installed';
            results.push({
              id: node.id,
              success: true,
              data: result.data
            });
          } else {
            node.state = 'failed';
            results.push({
              id: node.id,
              success: false,
              error: result.error
            });
            if (this.options.failFast) {
              return this.createFinalResult(results, plan, graph);
            }
          }
        } catch (error) {
          node.state = 'failed';
          const errMsg = error instanceof Error ? error.message : String(error);
          results.push({ id: node.id, success: false, error: errMsg });
          if (this.options.failFast) {
            return this.createFinalResult(results, plan, graph);
          }
        }
      }

      return this.createFinalResult(results, plan, graph);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errMsg,
        results,
        graph,
        warnings: graph?.metadata.warnings
      };
    }
  }

  private countLoadedNodes(graph: DependencyGraph): number {
    let n = 0;
    for (const node of graph.nodes.values()) {
      if (node.loaded) n++;
    }
    return n;
  }

  private findNodeForContext(
    ctx: { source: { packageName: string; contentRoot?: string } },
    graph: DependencyGraph
  ): import('./types.js').ResolutionDependencyNode | undefined {
    for (const node of graph.nodes.values()) {
      if (node.installContext === ctx) return node;
      if (
        node.loaded &&
        node.loaded.name === ctx.source.packageName &&
        node.loaded.contentRoot === ctx.source.contentRoot
      ) {
        return node;
      }
    }
    return undefined;
  }

  private createDryRunResult(
    plan: import('./types.js').InstallationPlan,
    graph: DependencyGraph
  ): ExecutionResult {
    return {
      success: true,
      results: [],
      summary: {
        total: graph.metadata.nodeCount,
        installed: 0,
        failed: 0,
        skipped: plan.skipped.length
      },
      graph,
      warnings: graph.metadata.warnings
    };
  }

  private createFinalResult(
    results: PackageResult[],
    plan: import('./types.js').InstallationPlan,
    graph: DependencyGraph
  ): ExecutionResult {
    const installed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const summary: ExecutionSummary = {
      total: graph.metadata.nodeCount,
      installed,
      failed,
      skipped: plan.skipped.length
    };
    return {
      success: failed === 0,
      results,
      summary,
      graph,
      error: failed > 0 ? `${failed} packages failed to install` : undefined,
      warnings: graph.metadata.warnings
    };
  }
}
