/**
 * Conversion Context Types
 * 
 * Provides immutable tracking of package format identity and conversion history
 * throughout the installation pipeline. This replaces the fragile approach of storing
 * format metadata in mutable `_format` fields.
 * 
 * @see plans/conversion-context-architecture.md
 */

import type { Platform } from '../core/platforms.js';

/**
 * Complete conversion context for a package
 * 
 * Tracks both the original format (immutable identity) and current format (mutable state)
 * as the package moves through the conversion pipeline.
 */
export interface PackageConversionContext {
  /**
   * Original format identity (immutable once set)
   * 
   * This represents what the package originally was when first discovered/loaded.
   * Used as the canonical source for `$$source` variable in flow conditionals.
   */
  readonly originalFormat: FormatIdentity;
  
  /**
   * Current format state (mutable)
   * 
   * Represents what format the package is currently in. Updated as conversions occur.
   */
  currentFormat: FormatState;
  
  /**
   * Complete conversion history (audit trail)
   * 
   * Records every conversion that has been applied to this package.
   * Useful for debugging and understanding the transformation pipeline.
   */
  conversionHistory: ConversionRecord[];
  
  /**
   * Target platform for current operation
   * 
   * The platform we're converting/installing to. Used for `$$platform` variable.
   */
  targetPlatform?: Platform;
}

/**
 * Immutable format identity
 * 
 * Represents the original format of a package when first discovered.
 * Never changes after initial detection.
 */
export interface FormatIdentity {
  /**
   * Format type classification
   */
  readonly type: 'universal' | 'platform-specific';
  
  /**
   * Platform identifier (if platform-specific)
   * 
   * This is the canonical source for `$$source` in flow conditionals.
   * Examples: 'claude-plugin', 'claude', 'cursor', 'openpackage'
   */
  readonly platform?: Platform;
  
  /**
   * When this format was first detected
   */
  readonly detectedAt: Date;
  
  /**
   * Confidence score from format detection (0-1)
   * 
   * 1.0 = Definitive detection (e.g., .claude-plugin/plugin.json exists)
   * 0.5-0.9 = Heuristic detection (majority of files match pattern)
   * < 0.5 = Low confidence (mixed or unclear)
   */
  readonly confidence: number;
}

/**
 * Mutable format state
 * 
 * Represents the current format of the package at any point in the pipeline.
 * Updated as conversions are applied.
 */
export interface FormatState {
  /**
   * Current format type
   */
  type: 'universal' | 'platform-specific';
  
  /**
   * Current platform (if platform-specific)
   */
  platform?: Platform;
}

/**
 * Record of a single conversion operation
 * 
 * Captures the transformation that occurred, including source, destination,
 * and the target platform that motivated the conversion.
 */
export interface ConversionRecord {
  /**
   * Format before conversion
   */
  from: FormatState;
  
  /**
   * Format after conversion
   */
  to: FormatState;
  
  /**
   * Target platform that motivated this conversion
   */
  targetPlatform: Platform;
  
  /**
   * When this conversion occurred
   */
  timestamp: Date;
}

/**
 * Result of creating/loading a package with context
 * 
 * Used at entry points (package loaders, transformers) to return both
 * the package data and its conversion context together.
 */
export interface PackageWithContext<T = any> {
  /**
   * The package data
   */
  package: T;
  
  /**
   * The conversion context
   */
  context: PackageConversionContext;
}

/**
 * Options for serializing context to JSON
 */
export interface ContextSerializationOptions {
  /**
   * Pretty-print the JSON output
   */
  pretty?: boolean;
  
  /**
   * Include full history (default: true)
   */
  includeHistory?: boolean;
}

/**
 * Serialized context format for storage
 * 
 * Simplified format for JSON serialization (dates as ISO strings)
 */
export interface SerializedConversionContext {
  originalFormat: {
    type: 'universal' | 'platform-specific';
    platform?: string;
    detectedAt: string;  // ISO 8601 date string
    confidence: number;
  };
  currentFormat: {
    type: 'universal' | 'platform-specific';
    platform?: string;
  };
  conversionHistory: Array<{
    from: {
      type: 'universal' | 'platform-specific';
      platform?: string;
    };
    to: {
      type: 'universal' | 'platform-specific';
      platform?: string;
    };
    targetPlatform: string;
    timestamp: string;  // ISO 8601 date string
  }>;
  targetPlatform?: string;
}
