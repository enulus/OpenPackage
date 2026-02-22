/**
 * Installation Strategies Module
 * 
 * Public API for installation strategies.
 * 
 * Exports:
 * - selectInstallStrategy: Main function for selecting appropriate strategy
 * - Strategy classes: For testing and advanced usage
 * - Types: Shared interfaces for strategy implementations
 */

// Main selector function
export { selectInstallStrategy } from './strategy-selector.js';

// Types for consumers
export type {
  FlowInstallContext,
  FlowInstallResult,
  FlowConflictReport,
  FlowInstallError,
  InstallationStrategy
} from './types.js';

// Strategy implementations (exported for testing/advanced usage)
export { ConversionInstallStrategy } from './conversion-strategy.js';
export { FlowBasedInstallStrategy } from './flow-based-strategy.js';

// Base class (exported for extensibility)
export { BaseStrategy } from './base-strategy.js';
