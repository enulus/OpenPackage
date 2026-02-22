import type { InstallOptions } from '../../../types/index.js';

/**
 * Validate that resolution flags are not conflicting.
 * @throws Error if both --remote and --local are specified
 */
export function validateResolutionFlags(
  options: InstallOptions & { local?: boolean; remote?: boolean }
): void {
  if (options.remote && options.local) {
    throw new Error('--remote and --local cannot be used together. Choose one resolution mode.');
  }
}

/**
 * Validate conflict strategy value.
 * @returns Normalized strategy value
 * @throws Error if invalid strategy
 */
export function validateConflictStrategy(
  strategy: string | undefined
): InstallOptions['conflictStrategy'] | undefined {
  if (!strategy) return undefined;
  
  const normalized = strategy.toLowerCase();
  const allowedStrategies: InstallOptions['conflictStrategy'][] = [
    'namespace', 'overwrite', 'skip', 'ask'
  ];
  
  if (!allowedStrategies.includes(normalized as any)) {
    throw new Error(
      `Invalid --conflicts value '${strategy}'. ` +
      `Use one of: namespace, overwrite, skip, ask.`
    );
  }
  
  return normalized as InstallOptions['conflictStrategy'];
}
