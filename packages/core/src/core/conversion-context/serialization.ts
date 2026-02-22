/**
 * Conversion Context Serialization
 * 
 * Functions for serializing/deserializing context to/from JSON for temp directory persistence.
 */

import type { 
  PackageConversionContext, 
  SerializedConversionContext,
  ContextSerializationOptions 
} from '../../types/conversion-context.js';
import type { Platform } from '../platforms.js';
import { logger } from '../../utils/logger.js';
import { validateContext } from './validation.js';

/**
 * Serialize context to JSON-friendly format
 * 
 * Converts Date objects to ISO strings for JSON serialization.
 */
export function serializeContext(
  context: PackageConversionContext,
  options?: ContextSerializationOptions
): SerializedConversionContext {
  const includeHistory = options?.includeHistory ?? true;
  
  return {
    originalFormat: {
      type: context.originalFormat.type,
      platform: context.originalFormat.platform,
      detectedAt: context.originalFormat.detectedAt.toISOString(),
      confidence: context.originalFormat.confidence
    },
    currentFormat: {
      type: context.currentFormat.type,
      platform: context.currentFormat.platform
    },
    conversionHistory: includeHistory ? context.conversionHistory.map(record => ({
      from: {
        type: record.from.type,
        platform: record.from.platform
      },
      to: {
        type: record.to.type,
        platform: record.to.platform
      },
      targetPlatform: record.targetPlatform,
      timestamp: record.timestamp.toISOString()
    })) : [],
    targetPlatform: context.targetPlatform
  };
}

/**
 * Deserialize context from JSON format
 * 
 * Converts ISO strings back to Date objects.
 * Validates the restored context.
 */
export function deserializeContext(
  serialized: SerializedConversionContext
): PackageConversionContext {
  const context: PackageConversionContext = {
    originalFormat: {
      type: serialized.originalFormat.type,
      platform: serialized.originalFormat.platform as Platform | undefined,
      detectedAt: new Date(serialized.originalFormat.detectedAt),
      confidence: serialized.originalFormat.confidence
    },
    currentFormat: {
      type: serialized.currentFormat.type,
      platform: serialized.currentFormat.platform as Platform | undefined
    },
    conversionHistory: serialized.conversionHistory.map(record => ({
      from: {
        type: record.from.type,
        platform: record.from.platform as Platform | undefined
      },
      to: {
        type: record.to.type,
        platform: record.to.platform as Platform | undefined
      },
      targetPlatform: record.targetPlatform as Platform,
      timestamp: new Date(record.timestamp)
    })),
    targetPlatform: serialized.targetPlatform as Platform | undefined
  };
  
  // Validate restored context
  try {
    validateContext(context);
  } catch (error) {
    logger.error('Deserialized context failed validation', { error });
    throw error;
  }
  
  return context;
}

/**
 * Serialize context to JSON string
 * 
 * Convenience function for writing to files.
 */
export function contextToJSON(
  context: PackageConversionContext,
  options?: ContextSerializationOptions
): string {
  const serialized = serializeContext(context, options);
  const pretty = options?.pretty ?? true;
  
  return JSON.stringify(serialized, null, pretty ? 2 : 0);
}

/**
 * Deserialize context from JSON string
 * 
 * Convenience function for reading from files.
 */
export function contextFromJSON(json: string): PackageConversionContext {
  try {
    const serialized = JSON.parse(json) as SerializedConversionContext;
    return deserializeContext(serialized);
  } catch (error) {
    logger.error('Failed to parse context JSON', { error });
    throw new Error(`Invalid context JSON: ${(error as Error).message}`);
  }
}

/**
 * Create a human-readable description of context
 * 
 * Useful for logging and debugging.
 */
export function describeContext(context: PackageConversionContext): string {
  const lines = [
    `Original: ${context.originalFormat.platform || 'universal'} (detected ${context.originalFormat.detectedAt.toISOString()})`,
    `Current: ${context.currentFormat.platform || 'universal'}`,
    `Target: ${context.targetPlatform || 'none'}`,
    `Conversions: ${context.conversionHistory.length}`
  ];
  
  if (context.conversionHistory.length > 0) {
    lines.push('History:');
    context.conversionHistory.forEach((h, i) => {
      lines.push(
        `  ${i + 1}. ${h.from.platform || 'universal'} → ${h.to.platform || 'universal'} ` +
        `(for ${h.targetPlatform}) at ${h.timestamp.toLocaleString()}`
      );
    });
  }
  
  return lines.join('\n');
}
