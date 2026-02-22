import { runSaveToSourcePipeline, type SaveToSourceOptions } from '../core/save/save-to-source-pipeline.js';

export async function setupSaveCommand(args: any[]): Promise<void> {
  const [packageName, options] = args as [string, SaveToSourceOptions];
  const result = await runSaveToSourcePipeline(packageName, options);
  if (!result.success) {
    throw new Error(result.error || 'Save operation failed');
  }
  if (result.data?.message) {
    console.log(result.data.message);
  }
}
