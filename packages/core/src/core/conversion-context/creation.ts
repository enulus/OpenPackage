/**
 * Conversion Context Creation
 * 
 * Functions for creating PackageConversionContext instances from various sources.
 */

import type { 
  PackageConversionContext, 
  FormatIdentity,
  FormatState 
} from '../../types/conversion-context.js';
import type { Platform } from '../platforms.js';
import type { PackageFormat } from '../install/format-detector.js';
import type { Package } from '../../types/index.js';
import { detectPackageFormat } from '../install/format-detector.js';
import { logger } from '../../utils/logger.js';

/**
 * Create context from detected package format
 * 
 * Use this at package discovery/loading time when format is detected.
 */
export function createContextFromFormat(format: PackageFormat): PackageConversionContext {
  const now = new Date();
  
  const originalFormat: FormatIdentity = {
    type: format.type,
    platform: format.platform,
    detectedAt: now,
    confidence: format.confidence
  };
  
  const currentFormat: FormatState = {
    type: format.type,
    platform: format.platform
  };
  
  logger.debug('Created conversion context from format', {
    type: format.type,
    platform: format.platform,
    confidence: format.confidence
  });
  
  return {
    originalFormat,
    currentFormat,
    conversionHistory: [],
    targetPlatform: undefined
  };
}

/**
 * Create context from package (detects format first)
 * 
 * Use this when loading a package without prior format information.
 * Fallback for backward compatibility during migration.
 */
export function createContextFromPackage(pkg: Package): PackageConversionContext {
  // Use existing _format if available (for backward compatibility)
  const format = pkg._format || detectPackageFormat(pkg.files);
  
  logger.debug('Creating context from package', {
    name: pkg.metadata.name,
    hasFormat: !!pkg._format,
    detectedType: format.type,
    detectedPlatform: format.platform
  });
  
  return createContextFromFormat(format);
}

/**
 * Create context for a known platform-specific package
 * 
 * Use this when you know definitively what platform a package is for
 * (e.g., when transforming a claude-plugin).
 */
export function createPlatformContext(
  platform: Platform,
  confidence: number = 1.0
): PackageConversionContext {
  const now = new Date();
  
  const originalFormat: FormatIdentity = {
    type: 'platform-specific',
    platform,
    detectedAt: now,
    confidence
  };
  
  const currentFormat: FormatState = {
    type: 'platform-specific',
    platform
  };
  
  logger.debug('Created platform-specific context', { platform, confidence });
  
  return {
    originalFormat,
    currentFormat,
    conversionHistory: [],
    targetPlatform: undefined
  };
}

/**
 * Create context for universal format package
 * 
 * Use this when loading a package that's already in universal format.
 */
export function createUniversalContext(
  confidence: number = 1.0
): PackageConversionContext {
  const now = new Date();
  
  const originalFormat: FormatIdentity = {
    type: 'universal',
    platform: undefined,
    detectedAt: now,
    confidence
  };
  
  const currentFormat: FormatState = {
    type: 'universal',
    platform: undefined
  };
  
  logger.debug('Created universal format context', { confidence });
  
  return {
    originalFormat,
    currentFormat,
    conversionHistory: [],
    targetPlatform: undefined
  };
}

/**
 * Update context with target platform
 * 
 * Sets the target platform for the current operation.
 * Returns a new context object (does not mutate).
 */
export function withTargetPlatform(
  context: PackageConversionContext,
  targetPlatform: Platform
): PackageConversionContext {
  return {
    ...context,
    targetPlatform
  };
}

/**
 * Update context after successful conversion
 * 
 * Records the conversion in history and updates current format.
 * Returns a new context object (does not mutate).
 */
export function updateContextAfterConversion(
  context: PackageConversionContext,
  newFormat: FormatState,
  targetPlatform: Platform
): PackageConversionContext {
  const timestamp = new Date();
  
  const newHistory = [
    ...context.conversionHistory,
    {
      from: context.currentFormat,
      to: newFormat,
      targetPlatform,
      timestamp
    }
  ];
  
  logger.debug('Updated context after conversion', {
    from: {
      type: context.currentFormat.type,
      platform: context.currentFormat.platform
    },
    to: {
      type: newFormat.type,
      platform: newFormat.platform
    },
    targetPlatform,
    totalConversions: newHistory.length
  });
  
  return {
    ...context,
    currentFormat: newFormat,
    conversionHistory: newHistory,
    targetPlatform
  };
}
