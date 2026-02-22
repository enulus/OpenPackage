/**
 * Modular dependency resolver
 * 
 * This module provides a clean structure for dependency resolution:
 * - types.ts: Type definitions (ResolvedPackage, DependencyNode)
 * - tree-utils.ts: Tree-related utilities for uninstall operations
 * - display.ts: Display utilities for showing dependency trees
 * - prompts.ts: Interactive prompt utilities
 * - resolver.ts: Legacy recursive resolver (deprecated, use DependencyResolutionExecutor)
 * 
 * For recursive dependency resolution in install commands, use:
 * - DependencyResolutionExecutor from '../install/resolution/executor.js'
 */

// Types
export type { ResolvedPackage, DependencyNode } from './types.js';

// Tree utilities (used by uninstall)
export {
  buildDependencyTree,
  getAllDependencies,
  findDanglingDependencies
} from './tree-utils.js';

// Display utilities
export { displayDependencyTree } from './display.js';

// Prompt utilities
export { promptOverwrite } from './prompts.js';

// Legacy resolver (still used by unified pipeline)
export { resolveDependencies, type ResolveDependenciesResult } from './resolver.js';
