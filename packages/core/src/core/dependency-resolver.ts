/**
 * @deprecated This file is deprecated. Import from './dependency-resolver/' instead.
 * 
 * This file exists only for backward compatibility and will be removed in a future version.
 * 
 * Migration guide:
 * - Types: import from './dependency-resolver/types.js'
 * - Tree utils: import from './dependency-resolver/tree-utils.js'
 * - Display: import from './dependency-resolver/display.js'
 * - Prompts: import from './dependency-resolver/prompts.js'
 * - Resolver: import from './dependency-resolver/resolver.js' (deprecated, use DependencyResolutionExecutor)
 */

// Re-export everything from the modular structure
export * from './dependency-resolver/index.js';
