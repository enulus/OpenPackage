/**
 * Dependency resolution executor.
 * Orchestrates discovery, loading, planning, and execution.
 */

import type { CommandResult, ExecutionContext } from '../../../types/index.js';
import { runUnifiedInstallPipeline } from '../unified/pipeline.js';
import { DependencyGraphBuilder } from './graph-builder.js';
import { PackageLoader } from './package-loader.js';
import { InstallationPlanner } from './installation-planner.js';
import { solveVersions, createInteractiveConflictHandler, type VersionSolution, type SolverOptions } from './version-solver.js';
import type { PromptPort } from '../../ports/prompt.js';
import { resolvePrompt } from '../../ports/resolve.js';
import { PromptTier } from '../../../core/interaction-policy.js';
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
    private readonly execContext: ExecutionContext,
    private readonly options: ExecutorOptions
  ) {
    this.graphBuilder = new DependencyGraphBuilder(execContext.targetDir, options.graphOptions);
    this.packageLoader = new PackageLoader(execContext, options.loaderOptions);
    this.planner = new InstallationPlanner(execContext, options.plannerOptions);
  }

  /**
   * Execute full dependency resolution and installation.
   */
  async execute(): Promise<ExecutionResult> {
    const results: PackageResult[] = [];
    let graph: DependencyGraph | undefined;
    let versionSolution: VersionSolution | undefined;

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

      const force = this.options.plannerOptions?.installOptions?.force ?? false;
      
      const solverOptions: SolverOptions = { force };
      if (!force && this.execContext.interactionPolicy?.canPrompt(PromptTier.ConflictResolution)) {
        const p = this.execContext.prompt ?? resolvePrompt();
        const versionSelector = async (packageName: string, versions: string[], action?: string): Promise<string | null> => {
          const choices = versions.map(v => ({ title: v, value: v }));
          return p.select<string>(
            `Select version of '${packageName}' ${action ?? ''}:`,
            choices,
            'Use arrow keys to navigate, Enter to select'
          );
        };
        solverOptions.onConflict = createInteractiveConflictHandler(versionSelector);
      }
      
      versionSolution = await solveVersions(graph, solverOptions);

      if (versionSolution.conflicts.length > 0 && !force) {
        for (const conflict of versionSolution.conflicts) {
          const ranges = conflict.ranges.join(', ');
          const requesters = conflict.requestedBy.join(', ');
          logger.error(`Version conflict for ${conflict.packageName}: ranges [${ranges}] requested by [${requesters}]`);
        }
        return {
          success: false,
          error: `Version conflicts detected for: ${versionSolution.conflicts.map(c => c.packageName).join(', ')}`,
          results: [],
          graph,
          warnings: graph.metadata.warnings,
          versionSolution
        };
      }

      for (const [packageName, resolvedVersion] of versionSolution.resolved) {
        for (const node of graph.nodes.values()) {
          if (node.source.type === 'registry' && node.source.packageName === packageName) {
            node.source.resolvedVersion = resolvedVersion;
          }
        }
      }

      logger.info('Loading packages');
      await this.packageLoader.loadAll(graph);

      const loadedCount = this.countLoadedNodes(graph);
      logger.info(`Loaded ${loadedCount}/${graph.metadata.nodeCount} packages`);

      logger.info('Planning installation');
      const plan = await this.planner.createPlan(graph);

      logger.info(`${plan.contexts.length} packages to install, ${plan.skipped.length} skipped`);

      if (this.options.dryRun) {
        return this.createDryRunResult(plan, graph, versionSolution);
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
              return this.createFinalResult(results, plan, graph, versionSolution);
            }
          }
        } catch (error) {
          node.state = 'failed';
          const errMsg = error instanceof Error ? error.message : String(error);
          results.push({ id: node.id, success: false, error: errMsg });
          if (this.options.failFast) {
            return this.createFinalResult(results, plan, graph, versionSolution);
          }
        }
      }

      return this.createFinalResult(results, plan, graph, versionSolution);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errMsg,
        results,
        graph,
        warnings: graph?.metadata.warnings,
        versionSolution
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
    graph: DependencyGraph,
    versionSolution?: VersionSolution
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
      warnings: graph.metadata.warnings,
      versionSolution
    };
  }

  private createFinalResult(
    results: PackageResult[],
    plan: import('./types.js').InstallationPlan,
    graph: DependencyGraph,
    versionSolution?: VersionSolution
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
      warnings: graph.metadata.warnings,
      versionSolution
    };
  }
}
