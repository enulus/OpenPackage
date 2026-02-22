import type { InstallOptions } from '../types/index.js';
import type { InstallResolutionMode } from '../types/install.js';

/**
 * Determine the resolution mode based on CLI flags
 */
export function determineResolutionMode(
  options: InstallOptions & { local?: boolean; remote?: boolean }
): InstallResolutionMode {
  if (options.resolutionMode) {
    return options.resolutionMode;
  }

  if ((options as any).remote) {
    return 'remote-primary';
  }

  if ((options as any).local) {
    return 'local-only';
  }

  return 'default';
}
