import { runSaveToSourcePipeline, type SaveToSourceOptions } from '@opkg/core/core/save/save-to-source-pipeline.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput } from '@opkg/core/core/ports/resolve.js';

export async function setupSaveCommand(args: any[]): Promise<void> {
  const [packageName, options] = args as [string, SaveToSourceOptions];
  const ctx = await createCliExecutionContext();
  const out = resolveOutput(ctx);
  const result = await runSaveToSourcePipeline(packageName, options);
  if (!result.success) {
    throw new Error(result.error || 'Save operation failed');
  }
  if (result.data?.message) {
    out.success(result.data.message);
  }
}
