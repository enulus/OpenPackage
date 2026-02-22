import type { CommandResult } from '../../../types/index.js';
import type { InstallationContext } from './context.js';
import { runUnifiedInstallPipeline } from './pipeline.js';
import { logger } from '../../../utils/logger.js';

export async function runMultiContextPipeline(
  contexts: InstallationContext[]
): Promise<CommandResult> {
  if (contexts.length === 0) {
    return { success: true, data: { installed: 0, skipped: 0, results: [] } };
  }

  let installed = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<{ name: string; success: boolean; error?: string }> = [];

  for (const ctx of contexts) {
    const result = await runUnifiedInstallPipeline(ctx);
    const name = (result.data as any)?.packageName || ctx.source.packageName || 'unknown';

    if (result.success) {
      installed += (result.data as any)?.installed ?? 0;
      skipped += (result.data as any)?.skipped ?? 0;
    } else {
      failed += 1;
      logger.error(`Failed to install ${name}: ${result.error}`);
    }

    results.push({
      name,
      success: result.success,
      error: result.success ? undefined : result.error
    });
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
