/**
 * Modular dependency resolver
 * 
 * This module provides shared types for dependency resolution:
 * - types.ts: Type definitions (ResolvedPackage, DependencyNode)
 *
 * For recursive dependency resolution in install commands, use:
 * - resolveWave() from '../install/wave-resolver/index.js'
 */

// Types
export type { ResolvedPackage, DependencyNode } from './types.js';
