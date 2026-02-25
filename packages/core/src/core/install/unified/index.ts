/**
 * Unified installation context and builders
 * 
 * This module provides a unified approach to installation contexts that works
 * across all installation scenarios (registry, path, git, apply).
 */

// Core types
export type {
  PackageSource,
  InstallationContext
} from './context.js';

// Context builders
export {
  buildRegistryInstallContext,
  buildPathInstallContext,
  buildGitInstallContext,
  buildInstallContext
} from './context-builders.js';

// Helper utilities
export {
  shouldUpdateManifest,
  addWarning,
  addError,
  getSourceDisplayName
} from './context-helpers.js';

// Pipeline
export { runUnifiedInstallPipeline } from './pipeline.js';

// Phase types
export type { ExecutionResult } from './phases/execute.js';
