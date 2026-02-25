/**
 * Wave-Based Parallel Installer
 *
 * Groups the topologically-sorted install order by wave number and installs
 * packages within each wave concurrently using bounded parallelism.
 *
 * Key safety properties:
 *  - Packages in the same wave have no inter-dependencies (by BFS definition)
 *  - Workspace index writes are deferred via IndexWriteCollector and flushed
 *    atomically after each wave completes
 *  - Ownership context for conflict detection is built once per wave and shared
 *  - Per-package output is buffered and flushed sequentially in install order
 */

import type { CommandResult, ExecutionContext } from '../../../types/index.js';
import type { WaveResult, WaveNode } from './types.js';
import type { NormalizedInstallOptions } from '../orchestrator/types.js';
import type { InstallOrchestrator } from '../orchestrator/orchestrator.js';
import type { InstallReportData } from '../install-reporting.js';
import { IndexWriteCollector } from './index-write-collector.js';
import { buildOwnershipContext } from '../conflicts/file-conflict-resolver.js';
import { BufferedOutputAdapter } from '../../ports/buffered-output.js';
import { runWithConcurrency } from '../../../utils/concurrency-pool.js';
import { updateWorkspaceIndex } from './index-updater.js';
import { resolveOutput } from '../../ports/resolve.js';
import { getInstalledPackageVersion } from '../../openpackage.js';
import { logger } from '../../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface WaveInstallerOptions {
  /** Maximum number of concurrent installs per wave (default: 4) */
  concurrencyLimit?: number;
  /** Stop processing remaining packages on first failure (default: false) */
  failFast?: boolean;
}

export interface WaveInstallResult {
  installed: number;
  failed: number;
  skipped: number;
  results: Array<{ id: string; success: boolean; error?: string }>;
  /** Collected report data from each successful install (for merged display) */
  reportDataList: InstallReportData[];
  warnings: string[];
}

// ============================================================================
// Wave grouping
// ============================================================================

/**
 * Group install-order nodes by their wave number.
 * Returns a Map ordered by wave number (ascending).
 */
function groupByWave(
  waveResult: WaveResult
): Map<number, WaveNode[]> {
  const groups = new Map<number, WaveNode[]>();

  for (const nodeId of waveResult.graph.installOrder) {
    const node = waveResult.graph.nodes.get(nodeId);
    if (!node) continue;
    const wave = node.wave;
    if (!groups.has(wave)) {
      groups.set(wave, []);
    }
    groups.get(wave)!.push(node);
  }

  // Sort by wave number
  const sorted = new Map(
    [...groups.entries()].sort(([a], [b]) => a - b)
  );
  return sorted;
}

/**
 * Reconstruct an install input string from a WaveNode's declaration.
 * Produces the same format that classifyInput() expects.
 */
function nodeToInstallInput(node: WaveNode): string | null {
  const decl = node.declarations[0];
  if (!decl) return null;

  if (node.sourceType === 'git') {
    if (decl.name && decl.name.startsWith('gh@')) {
      return decl.name;
    }
    if (decl.url) {
      let input = decl.url;
      if (decl.ref) input += `#${decl.ref}`;
      return input;
    }
    return decl.name || null;
  }

  if (node.sourceType === 'path') {
    return node.source.absolutePath ?? node.source.contentRoot ?? decl.path ?? null;
  }

  // Registry deps: name with optional version
  const name = decl.name;
  if (!name) return null;
  const version = node.resolvedVersion ?? decl.version;
  return version && version !== '*' ? `${name}@${version}` : name;
}

// ============================================================================
// Main installer
// ============================================================================

/**
 * Install packages in wave-parallel order.
 *
 * For each BFS wave:
 *  1. Build shared ownership context (single index read)
 *  2. Create IndexWriteCollector for deferred writes
 *  3. Run all installs in the wave concurrently (bounded)
 *  4. Flush deferred index writes atomically
 *  5. Flush buffered output in order
 */
export async function installInWaves(
  orchestrator: InstallOrchestrator,
  waveResult: WaveResult,
  options: NormalizedInstallOptions,
  execContext: ExecutionContext,
  installerOptions?: WaveInstallerOptions
): Promise<WaveInstallResult> {
  const { concurrencyLimit = 4, failFast = false } = installerOptions ?? {};
  const force = options.force ?? false;
  const targetDir = execContext.targetDir;
  const realOutput = resolveOutput(execContext);

  const depOptions: NormalizedInstallOptions = {
    ...options,
    skipManifestUpdate: true,
    _skipDependencyInstall: true,
  };

  let totalInstalled = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const allResults: Array<{ id: string; success: boolean; error?: string }> = [];
  const allReportData: InstallReportData[] = [];
  const allWarnings: string[] = [...(waveResult.graph.warnings || [])];
  let aborted = false;

  const waveGroups = groupByWave(waveResult);

  for (const [waveNum, nodes] of waveGroups) {
    if (aborted) break;

    // Filter out marketplace nodes and already-installed packages
    const installableNodes: WaveNode[] = [];
    for (const node of nodes) {
      if (node.isMarketplace) {
        totalSkipped++;
        continue;
      }

      const packageName = node.source.packageName ?? node.metadata?.name ?? node.displayName;
      if (!force) {
        const installedVersion = await getInstalledPackageVersion(packageName, targetDir);
        if (installedVersion) {
          totalSkipped++;
          continue;
        }
      }

      const input = nodeToInstallInput(node);
      if (!input) {
        logger.warn(`Could not reconstruct install input for ${packageName}, skipping`);
        totalSkipped++;
        continue;
      }

      installableNodes.push(node);
    }

    if (installableNodes.length === 0) continue;

    // Determine if this wave should run in parallel
    const useParallel = installableNodes.length > 1 && concurrencyLimit > 1;

    if (useParallel) {
      // Build shared ownership context for the wave (single index read)
      let sharedOwnership;
      try {
        sharedOwnership = await buildOwnershipContext(targetDir, '__wave__', null);
      } catch (error) {
        logger.warn(`Failed to build ownership context for wave ${waveNum}: ${error}`);
        sharedOwnership = undefined;
      }

      // Create collector for deferred index writes
      const collector = new IndexWriteCollector();

      // Build task array
      const taskMeta: Array<{ node: WaveNode; packageName: string; input: string }> = [];
      const tasks = installableNodes.map((node) => {
        const packageName = node.source.packageName ?? node.metadata?.name ?? node.displayName;
        const input = nodeToInstallInput(node)!;
        taskMeta.push({ node, packageName, input });

        return async (): Promise<{ result: CommandResult; packageName: string; buffered: BufferedOutputAdapter }> => {
          const buffered = new BufferedOutputAdapter();
          const nodeExecContext: ExecutionContext = {
            ...execContext,
            output: buffered,
            indexWriteCollector: collector,
            sharedOwnershipContext: sharedOwnership,
            // Disable mode commitment for parallel installs (already committed)
            commitOutputMode: undefined,
          };

          const result = await orchestrator.execute(input, depOptions, nodeExecContext);
          return { result, packageName, buffered };
        };
      });

      // Execute wave with bounded concurrency
      const waveResults = await runWithConcurrency(tasks, concurrencyLimit, { failFast });

      // Flush deferred index writes atomically
      if (collector.hasMutations) {
        await collector.flush(targetDir);
      }

      // Process results and flush output in order
      for (let i = 0; i < waveResults.results.length; i++) {
        const entry = waveResults.results[i];
        const { packageName } = taskMeta[i];

        if (entry.status === 'fulfilled') {
          const { result, buffered } = entry.value;
          buffered.flush(realOutput);

          if (result.success) {
            totalInstalled++;
            allResults.push({ id: packageName, success: true });
            const reportData = (result as any)._reportData;
            if (reportData) allReportData.push(reportData);
          } else {
            totalFailed++;
            allResults.push({ id: packageName, success: false, error: result.error });
          }
        } else {
          totalFailed++;
          const errMsg = entry.error.message;
          logger.warn(`Failed to install ${packageName}: ${errMsg}`);
          allResults.push({ id: packageName, success: false, error: errMsg });
        }
      }

      if (failFast && totalFailed > 0) {
        aborted = true;
      }
    } else {
      // Sequential execution for single-node waves (no overhead)
      for (const node of installableNodes) {
        if (aborted) break;

        const packageName = node.source.packageName ?? node.metadata?.name ?? node.displayName;
        const input = nodeToInstallInput(node)!;

        try {
          const result = await orchestrator.execute(input, depOptions, execContext);
          if (result.success) {
            totalInstalled++;
            allResults.push({ id: packageName, success: true });
            const reportData = (result as any)._reportData;
            if (reportData) allReportData.push(reportData);
          } else {
            totalFailed++;
            allResults.push({ id: packageName, success: false, error: result.error });
            if (failFast) aborted = true;
          }
        } catch (error) {
          totalFailed++;
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.warn(`Failed to install ${packageName}: ${errMsg}`);
          allResults.push({ id: packageName, success: false, error: errMsg });
          if (failFast) aborted = true;
        }
      }
    }
  }

  // Update workspace index with dependency graph information
  await updateWorkspaceIndex(targetDir, waveResult.graph);

  return {
    installed: totalInstalled,
    failed: totalFailed,
    skipped: totalSkipped,
    results: allResults,
    reportDataList: allReportData,
    warnings: allWarnings,
  };
}
