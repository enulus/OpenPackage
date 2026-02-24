import type { CommandResult } from '../../../types/index.js';
import type { InstallationContext } from './context.js';
import type { InstallReportData } from '../install-reporting.js';
import { displayInstallationResults } from '../install-reporting.js';
import { runUnifiedInstallPipeline } from './pipeline.js';
import { resolveOutput } from '../../ports/resolve.js';

export interface MultiContextPipelineOptions {
  /** When true, suppress per-context reports and emit one grouped report at the end */
  groupReport?: boolean;
  /** Package name for the grouped report (uses first context's packageName when omitted) */
  groupReportPackageName?: string;
}

export async function runMultiContextPipeline(
  contexts: InstallationContext[],
  options?: MultiContextPipelineOptions
): Promise<CommandResult> {
  if (contexts.length === 0) {
    return { success: true, data: { installed: 0, skipped: 0, results: [] } };
  }

  const { groupReport, groupReportPackageName } = options ?? {};

  let installed = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<{ name: string; success: boolean; error?: string }> = [];
  const reportDataList: InstallReportData[] = [];

  for (const ctx of contexts) {
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

function mergeInstallReportData(
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
  const relocatedFiles = list.flatMap(r => r.relocatedFiles ?? []);
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
    relocatedFiles,
    replacedResources: replacedResources.length > 0 ? replacedResources : undefined,
    namespaced: list.some(r => r.namespaced),
    resolvedPackages: first.resolvedPackages
  };
}
