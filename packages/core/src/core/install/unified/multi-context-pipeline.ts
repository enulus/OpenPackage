import type { CommandResult } from '../../../types/index.js';
import type { InstallationContext } from './context.js';
import type { InstallReportData } from '../install-reporting.js';
import { displayInstallationResults } from '../install-reporting.js';
import { runUnifiedInstallPipeline } from './pipeline.js';
import { resolveOutput } from '../../ports/resolve.js';
import { checkSubsumption } from '../orchestrator/subsumption-resolver.js';
import type { OutputPort } from '../../ports/output.js';

export interface MultiContextPipelineOptions {
  /** When true, suppress per-context reports and emit one grouped report at the end */
  groupReport?: boolean;
  /** Package name for the grouped report (uses first context's packageName when omitted) */
  groupReportPackageName?: string;
  /** When true, stop processing remaining contexts on the first failure */
  failFast?: boolean;
}

export async function runMultiContextPipeline(
  contexts: InstallationContext[],
  options?: MultiContextPipelineOptions
): Promise<CommandResult> {
  if (contexts.length === 0) {
    return { success: true, data: { installed: 0, skipped: 0, results: [] } };
  }

  const { groupReport, groupReportPackageName, failFast } = options ?? {};
  const out = resolveOutput(contexts[0].execution);

  // Pre-filter: remove contexts already covered by a broader installed package.
  // Mark surviving contexts so the pipeline phase does not re-check.
  const { active: activeContexts, skippedCount: preSkipped } =
    await filterSubsumedContexts(contexts, out);

  if (activeContexts.length === 0) {
    return {
      success: true,
      data: {
        installed: 0,
        skipped: preSkipped,
        results: [],
        reason: 'All resources already installed via full package'
      }
    };
  }

  let installed = 0;
  let skipped = preSkipped;
  let failed = 0;
  const results: Array<{ name: string; success: boolean; error?: string }> = [];
  const reportDataList: InstallReportData[] = [];

  for (const ctx of activeContexts) {
    if (groupReport) {
      ctx._deferredReport = true;
    }

    const result = await runUnifiedInstallPipeline(ctx);
    const name = (result.data as any)?.packageName || ctx.source.packageName || 'unknown';

    if (result.success) {
      installed += (result.data as any)?.installed ?? 0;
      skipped += (result.data as any)?.skipped ?? 0;
      const reportData = (result as any)._reportData;
      if (reportData) {
        reportDataList.push(reportData);
      }
    } else {
      failed += 1;
      if (failFast) {
        // Record remaining contexts as skipped
        results.push({
          name,
          success: false,
          error: result.error
        });
        break;
      }
    }

    results.push({
      name,
      success: result.success,
      error: result.success ? undefined : result.error
    });
  }

  if (groupReport && reportDataList.length > 0) {
    const merged = mergeInstallReportData(reportDataList, {
      packageName: groupReportPackageName ?? contexts[0].source.packageName
    });
    const output = resolveOutput(contexts[0].execution);
    displayInstallationResults(merged, output);
  }

  const success = failed === 0;
  return {
    success,
    data: {
      installed,
      skipped,
      results
    },
    error: success ? undefined : `${failed} resource${failed === 1 ? '' : 's'} failed to install`
  };
}

/**
 * Filter out contexts whose resources are already covered by a broader
 * installed package (subsumption "already-covered" check).
 *
 * Contexts that survive filtering have `_subsumptionChecked` set to true
 * so the pipeline's own subsumption phase does not re-check them.
 * Exported for testability.
 */
export async function filterSubsumedContexts(
  contexts: InstallationContext[],
  out: OutputPort
): Promise<{ active: InstallationContext[]; skippedCount: number }> {
  const active: InstallationContext[] = [];
  let skippedCount = 0;

  for (const ctx of contexts) {
    if (ctx.options?.force) {
      ctx._subsumptionChecked = true;
      active.push(ctx);
      continue;
    }

    const result = await checkSubsumption(ctx.source, ctx.targetDir);
    if (result.type === 'already-covered') {
      const resourcePath = ctx.source.resourcePath ||
        ctx.source.packageName.replace(/^.*?\/[^/]+\/[^/]+\//, '');
      out.info(`Skipped: ${resourcePath} is already installed via ${result.coveringPackage}`);
      skippedCount++;
    } else {
      ctx._subsumptionChecked = true;
      active.push(ctx);
    }
  }

  return { active, skippedCount };
}

export function mergeInstallReportData(
  list: InstallReportData[],
  overrides: { packageName?: string }
): InstallReportData {
  const first = list[0];
  const installedFiles = list.flatMap(r => r.installedFiles ?? []);
  const updatedFiles = list.flatMap(r => r.updatedFiles ?? []);

  const rootInstalled = list.flatMap(r => r.rootFileResults?.installed ?? []);
  const rootUpdated = list.flatMap(r => r.rootFileResults?.updated ?? []);
  const rootSkipped = list.flatMap(r => r.rootFileResults?.skipped ?? []);

  const errorCount = list.reduce((sum, r) => sum + (r.errorCount ?? 0), 0);
  const errors = list.flatMap(r => r.errors ?? []);
  const namespacedFiles = list.flatMap(r => r.namespacedFiles ?? []);
  const relocatedFiles = list.flatMap(r => r.relocatedFiles ?? []);
  const claimedFiles = list.flatMap(r => r.claimedFiles ?? []);
  const replacedResources = list.flatMap(r => r.replacedResources ?? []);

  return {
    ...first,
    packageName: overrides.packageName ?? first.packageName,
    installedFiles,
    updatedFiles,
    rootFileResults: {
      installed: rootInstalled,
      updated: rootUpdated,
      skipped: rootSkipped
    },
    errorCount,
    errors,
    namespaced: namespacedFiles.length > 0 || undefined,
    namespacedFiles: namespacedFiles.length > 0 ? namespacedFiles : undefined,
    relocatedFiles,
    claimedFiles: claimedFiles.length > 0 ? claimedFiles : undefined,
    replacedResources: replacedResources.length > 0 ? replacedResources : undefined,
    resolvedPackages: first.resolvedPackages
  };
}
