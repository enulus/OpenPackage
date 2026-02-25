/**
 * Bounded concurrency pool for running async tasks in parallel.
 *
 * Uses a worker-pool pattern: N workers pull tasks from a shared queue.
 * Each worker runs sequentially, but up to `limit` workers run concurrently.
 */

export interface ConcurrencyResult<T> {
  /** Per-task results in the same order as the input tasks array */
  results: Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; error: Error }>;
  /** Count of successfully completed tasks */
  succeeded: number;
  /** Count of failed tasks */
  failed: number;
}

export interface ConcurrencyOptions {
  /** Stop processing remaining tasks on the first failure (default: false) */
  failFast?: boolean;
}

/**
 * Run an array of async task factories with bounded concurrency.
 *
 * @param tasks   - Array of zero-argument async functions that return a value
 * @param limit   - Maximum number of tasks to run in parallel
 * @param options - Optional settings (failFast, etc.)
 * @returns Results in the same order as the input tasks, with status per task
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
  options?: ConcurrencyOptions
): Promise<ConcurrencyResult<T>> {
  if (tasks.length === 0) {
    return { results: [], succeeded: 0, failed: 0 };
  }

  const { failFast = false } = options ?? {};
  const effectiveLimit = Math.max(1, Math.min(limit, tasks.length));

  const results: ConcurrencyResult<T>['results'] = new Array(tasks.length);
  let nextIndex = 0;
  let succeeded = 0;
  let failed = 0;
  let cancelled = false;

  async function runWorker(): Promise<void> {
    while (!cancelled) {
      const i = nextIndex++;
      if (i >= tasks.length) break;

      try {
        const value = await tasks[i]();
        results[i] = { status: 'fulfilled', value };
        succeeded++;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        results[i] = { status: 'rejected', error };
        failed++;

        if (failFast) {
          cancelled = true;
          break;
        }
      }
    }
  }

  const workers = Array.from({ length: effectiveLimit }, () => runWorker());
  await Promise.all(workers);

  // Mark any un-started tasks as rejected with a cancellation error
  for (let i = 0; i < tasks.length; i++) {
    if (!results[i]) {
      results[i] = { status: 'rejected', error: new Error('Task cancelled (failFast)') };
      failed++;
    }
  }

  return { results, succeeded, failed };
}
