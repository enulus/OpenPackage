import type { InstallOptions } from '../../../types/index.js';
import type { NormalizedInstallOptions } from '../orchestrator/types.js';
import { normalizePlatforms } from '../../../utils/platform-mapper.js';
import { determineResolutionMode } from '../../../utils/resolution-mode.js';
import { validateConflictStrategy } from '../validators/options-validator.js';

/**
 * Normalize --plugins option by deduplicating.
 */
export function normalizePluginsOption(value: string[] | undefined): string[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }
  const plugins = [...new Set(value)];
  return plugins.length > 0 ? plugins : undefined;
}

/**
 * Normalize all install options at CLI boundary.
 * This creates immutable, properly typed options for the install flow.
 */
export function normalizeInstallOptions(
  options: InstallOptions & { 
    conflicts?: string;
    agents?: string[];
    skills?: string[];
    rules?: string[];
    commands?: string[];
    list?: boolean;
  }
): NormalizedInstallOptions {
  // Normalize platforms
  const platforms = normalizePlatforms(options.platforms);

  // Normalize plugins
  const plugins = normalizePluginsOption(options.plugins);

  // Normalize and validate conflict strategy
  const rawConflictStrategy = options.conflicts ?? options.conflictStrategy;
  const conflictStrategy = validateConflictStrategy(rawConflictStrategy) ?? 'ask';

  // Determine resolution mode
  const resolutionMode = determineResolutionMode(options);

  return {
    ...options,
    platforms,
    plugins,
    conflictStrategy,
    resolutionMode,
    agents: options.agents,
    skills: options.skills,
    rules: options.rules,
    commands: options.commands,
    list: options.list,
  };
}
