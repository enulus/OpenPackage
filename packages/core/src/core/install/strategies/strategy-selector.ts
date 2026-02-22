/**
 * Strategy Selector Module
 * 
 * Selects the appropriate installation strategy based on package format and target platform.
 */

import type { InstallOptions } from '../../../types/index.js';
import type { FlowInstallContext, InstallationStrategy } from './types.js';
import { ConversionInstallStrategy } from './conversion-strategy.js';
import { FlowBasedInstallStrategy } from './flow-based-strategy.js';
import { needsConversion } from '../format-detector.js';

/**
 * Select the appropriate installation strategy based on package format and platform
 * 
 * Strategy selection:
 * 1. ConversionInstallStrategy - Cross-platform conversion required (source ≠ target)
 * 2. FlowBasedInstallStrategy - Default for all other cases (universal or same-platform)
 * 
 * @param context - Installation context with package metadata
 * @param options - Installation options
 * @returns Selected installation strategy
 */
export function selectInstallStrategy(
  context: FlowInstallContext,
  options?: InstallOptions
): InstallationStrategy {
  const format = context.packageFormat;
  const platform = context.platform;
  
  // If no format provided, default to flow-based strategy
  if (!format) {
    return new FlowBasedInstallStrategy();
  }
  
  // Check if conversion is needed
  if (needsConversion(format, platform)) {
    return new ConversionInstallStrategy();
  }
  
  // Default: flow-based strategy
  return new FlowBasedInstallStrategy();
}
