/**
 * Conversion Context Module
 * 
 * Provides utilities for creating, validating, and serializing
 * PackageConversionContext throughout the installation pipeline.
 * 
 * @see plans/conversion-context-architecture.md
 */

// Re-export all utilities
export * from './creation.js';
export * from './validation.js';
export * from './serialization.js';
