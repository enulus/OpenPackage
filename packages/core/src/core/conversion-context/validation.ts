/**
 * Conversion Context Validation
 * 
 * Functions for validating context integrity at creation and transition points.
 */

import type { PackageConversionContext, FormatState } from '../../types/conversion-context.js';
import type { Package } from '../../types/index.js';
import { detectPackageFormat } from '../install/format-detector.js';
import { logger } from '../../utils/logger.js';

/**
 * Validation error thrown when context integrity is violated
 */
export class ContextValidationError extends Error {
  constructor(message: string, public context?: PackageConversionContext) {
    super(message);
    this.name = 'ContextValidationError';
  }
}

/**
 * Validate a newly created context
 * 
 * Checks for required fields and basic integrity.
 * Throws ContextValidationError if invalid.
 */
export function validateNewContext(context: PackageConversionContext): void {
  // Check required fields
  if (!context.originalFormat) {
    throw new ContextValidationError('Context missing originalFormat');
  }
  
  if (!context.currentFormat) {
    throw new ContextValidationError('Context missing currentFormat');
  }
  
  // Check history is array
  if (!Array.isArray(context.conversionHistory)) {
    throw new ContextValidationError('conversionHistory must be an array');
  }
  
  // Validate originalFormat
  if (!context.originalFormat.type) {
    throw new ContextValidationError('originalFormat missing type field');
  }
  
  if (context.originalFormat.type !== 'universal' && context.originalFormat.type !== 'platform-specific') {
    throw new ContextValidationError(
      `originalFormat.type must be 'universal' or 'platform-specific', got: ${context.originalFormat.type}`
    );
  }
  
  if (context.originalFormat.type === 'platform-specific' && !context.originalFormat.platform) {
    throw new ContextValidationError('originalFormat.type is platform-specific but platform is undefined');
  }
  
  if (context.originalFormat.confidence < 0 || context.originalFormat.confidence > 1) {
    throw new ContextValidationError(
      `originalFormat.confidence must be between 0 and 1, got: ${context.originalFormat.confidence}`
    );
  }
  
  // Validate currentFormat matches originalFormat initially
  if (context.conversionHistory.length === 0) {
    if (context.currentFormat.type !== context.originalFormat.type) {
      logger.warn('New context has mismatched current/original format types', {
        originalType: context.originalFormat.type,
        currentType: context.currentFormat.type
      });
    }
    
    if (context.currentFormat.platform !== context.originalFormat.platform) {
      logger.warn('New context has mismatched current/original platforms', {
        originalPlatform: context.originalFormat.platform,
        currentPlatform: context.currentFormat.platform
      });
    }
  }
  
  logger.debug('Context validation passed', {
    type: context.originalFormat.type,
    platform: context.originalFormat.platform
  });
}

/**
 * Validate context transition (before -> after)
 * 
 * Ensures originalFormat is immutable and history is consistent.
 * Throws ContextValidationError if invalid.
 */
export function validateContextTransition(
  before: PackageConversionContext,
  after: PackageConversionContext
): void {
  // Original format MUST NOT change
  if (JSON.stringify(before.originalFormat) !== JSON.stringify(after.originalFormat)) {
    throw new ContextValidationError(
      'originalFormat changed during transition! ' +
      `Before: ${JSON.stringify(before.originalFormat)}, ` +
      `After: ${JSON.stringify(after.originalFormat)}`,
      after
    );
  }
  
  // History should only grow
  if (after.conversionHistory.length < before.conversionHistory.length) {
    throw new ContextValidationError(
      `conversionHistory was truncated: before=${before.conversionHistory.length}, after=${after.conversionHistory.length}`,
      after
    );
  }
  
  // If history grew, validate new entry
  if (after.conversionHistory.length > before.conversionHistory.length) {
    const newEntry = after.conversionHistory[after.conversionHistory.length - 1];
    
    if (!newEntry.from || !newEntry.to || !newEntry.targetPlatform) {
      throw new ContextValidationError('Invalid conversion history entry: missing required fields', after);
    }
    
    // Check that 'from' matches before.currentFormat
    if (JSON.stringify(newEntry.from) !== JSON.stringify(before.currentFormat)) {
      logger.warn('History entry "from" does not match previous currentFormat', {
        historyFrom: newEntry.from,
        previousCurrent: before.currentFormat
      });
    }
    
    // Check that 'to' matches after.currentFormat
    if (JSON.stringify(newEntry.to) !== JSON.stringify(after.currentFormat)) {
      logger.warn('History entry "to" does not match new currentFormat', {
        historyTo: newEntry.to,
        newCurrent: after.currentFormat
      });
    }
  }
  
  logger.debug('Context transition validation passed', {
    conversions: after.conversionHistory.length
  });
}

/**
 * Validate that context matches package files
 * 
 * Detects format from package and compares with context.
 * Logs warning if mismatch (doesn't throw).
 */
export function validateContextMatchesPackage(
  pkg: Package,
  context: PackageConversionContext
): void {
  // Detect format from package files
  const detectedFormat = detectPackageFormat(pkg.files);
  
  // Compare with context.currentFormat
  if (detectedFormat.type !== context.currentFormat.type) {
    logger.warn('Package format type mismatch', {
      packageName: pkg.metadata.name,
      detected: detectedFormat.type,
      contextCurrent: context.currentFormat.type,
      contextOriginal: context.originalFormat.type
    });
  }
  
  if (detectedFormat.platform !== context.currentFormat.platform) {
    // Only warn if detection confidence is high
    if (detectedFormat.confidence >= 0.7) {
      logger.warn('Package format platform mismatch (high confidence)', {
        packageName: pkg.metadata.name,
        detected: detectedFormat.platform,
        contextCurrent: context.currentFormat.platform,
        contextOriginal: context.originalFormat.platform,
        confidence: detectedFormat.confidence
      });
    } else {
      logger.debug('Package format platform mismatch (low confidence, trusting context)', {
        packageName: pkg.metadata.name,
        detected: detectedFormat.platform,
        contextCurrent: context.currentFormat.platform,
        confidence: detectedFormat.confidence
      });
    }
  }
}

/**
 * Validate context history internal consistency
 * 
 * Checks that each conversion record links correctly to the next.
 * Throws ContextValidationError if inconsistent.
 */
export function validateContextHistory(context: PackageConversionContext): void {
  if (context.conversionHistory.length === 0) {
    return; // Empty history is valid
  }
  
  // First entry should start from original format
  const firstEntry = context.conversionHistory[0];
  if (firstEntry.from.type !== context.originalFormat.type ||
      firstEntry.from.platform !== context.originalFormat.platform) {
    logger.warn('First history entry does not match original format', {
      historyFrom: firstEntry.from,
      originalFormat: context.originalFormat
    });
  }
  
  // Each entry should chain to the next
  for (let i = 0; i < context.conversionHistory.length - 1; i++) {
    const current = context.conversionHistory[i];
    const next = context.conversionHistory[i + 1];
    
    if (JSON.stringify(current.to) !== JSON.stringify(next.from)) {
      throw new ContextValidationError(
        `History chain broken at index ${i}: ` +
        `entry ${i} 'to' (${JSON.stringify(current.to)}) does not match ` +
        `entry ${i + 1} 'from' (${JSON.stringify(next.from)})`,
        context
      );
    }
  }
  
  // Last entry should match current format
  const lastEntry = context.conversionHistory[context.conversionHistory.length - 1];
  if (JSON.stringify(lastEntry.to) !== JSON.stringify(context.currentFormat)) {
    logger.warn('Last history entry does not match current format', {
      historyTo: lastEntry.to,
      currentFormat: context.currentFormat
    });
  }
  
  logger.debug('Context history validation passed', {
    entries: context.conversionHistory.length
  });
}

/**
 * Validate complete context (all checks)
 * 
 * Runs all validation checks. Throws on any error.
 */
export function validateContext(context: PackageConversionContext): void {
  validateNewContext(context);
  validateContextHistory(context);
}
