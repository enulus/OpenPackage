import { VERSION } from '../generated/version.js';

/**
 * Get the version from build-time constant
 */
export function getVersion(): string {
  return VERSION;
}
