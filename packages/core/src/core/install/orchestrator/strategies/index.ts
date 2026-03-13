import type { InstallStrategy } from '../types.js';
import { GitInstallStrategy } from './git-strategy.js';
import { PathInstallStrategy } from './path-strategy.js';
import { RegistryInstallStrategy } from './registry-strategy.js';
import { BulkInstallStrategy } from './bulk-strategy.js';
import { EmbeddedInstallStrategy } from './embedded-strategy.js';

export { BaseInstallStrategy } from './base.js';
export { GitInstallStrategy } from './git-strategy.js';
export { PathInstallStrategy } from './path-strategy.js';
export { RegistryInstallStrategy } from './registry-strategy.js';
export { BulkInstallStrategy } from './bulk-strategy.js';
export { EmbeddedInstallStrategy } from './embedded-strategy.js';

/**
 * Create all install strategies.
 */
export function createAllStrategies(): InstallStrategy[] {
  return [
    new BulkInstallStrategy(),
    new EmbeddedInstallStrategy(),
    new GitInstallStrategy(),
    new PathInstallStrategy(),
    new RegistryInstallStrategy(),
  ];
}
