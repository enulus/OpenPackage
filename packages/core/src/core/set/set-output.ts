/**
 * @fileoverview Output formatting and display for the set command
 */

import { formatPathForDisplay } from '../../utils/formatters.js';
import type { PackageYml } from '../../types/index.js';
import type { ConfigChange, SetPipelineResult } from './set-types.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

/**
 * Display changes that will be applied to the manifest
 */
export function displayConfigChanges(changes: ConfigChange[], output?: OutputPort): void {
  const out = output ?? resolveOutput();

  if (changes.length === 0) {
    out.info('\nNo changes detected.');
    return;
  }

  out.info('\n📝 Changes to apply:');
  
  for (const change of changes) {
    const oldDisplay = formatValue(change.oldValue);
    const newDisplay = formatValue(change.newValue);
    out.info(`  ${change.field}: ${oldDisplay} → ${newDisplay}`);
  }
}

/**
 * Format a value for display in change output
 */
function formatValue(value: any): string {
  if (value === undefined || value === null) {
    return '(not set)';
  }
  
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return `[${value.join(', ')}]`;
  }
  
  if (typeof value === 'boolean') {
    return value.toString();
  }
  
  if (typeof value === 'string') {
    return value;
  }
  
  return JSON.stringify(value);
}

/**
 * Display success message after updating manifest
 */
export function displaySetSuccess(
  result: SetPipelineResult,
  cwd: string,
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
  const displayPath = formatPathForDisplay(result.packagePath, cwd);
  
  out.success(`Updated ${result.packageName} manifest`);
  out.info(`  Path: ${displayPath}`);
  out.info(`  Type: ${result.sourceType} package`);
  
  if (result.updatedFields.length > 0) {
    const fieldList = result.updatedFields.join(', ');
    out.info(`  Updated: ${fieldList}`);
  }
}

/**
 * Display current package configuration for interactive mode
 */
export function displayCurrentConfig(config: PackageYml, packagePath: string, output?: OutputPort): void {
  const out = output ?? resolveOutput();

  out.info(`\nCurrent package: ${config.name}`);
  
  if (config.version) {
    out.info(`Version: ${config.version}`);
  }
  
  out.info(`Path: ${packagePath}`);
  out.info('\nLeave blank to keep current value, or enter new value:\n');
}

/**
 * Display no-changes message
 */
export function displayNoChanges(packageName: string, output?: OutputPort): void {
  const out = output ?? resolveOutput();

  out.success(`No changes made to ${packageName}`);
  out.info('  Manifest unchanged');
}
