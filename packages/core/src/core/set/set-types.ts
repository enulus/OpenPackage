/**
 * @fileoverview Type definitions for the set command
 */

import type { PackageYml } from '../../types/index.js';

/**
 * Options for the set command
 */
export interface SetCommandOptions {
  // Field flags
  ver?: string;
  name?: string;
  description?: string;
  keywords?: string;  // Space-separated string, will be parsed to array
  author?: string;
  license?: string;
  homepage?: string;
  private?: boolean;
  
  // Behavior flags
  force?: boolean;  // Skip confirmation prompts
  nonInteractive?: boolean;  // Error if no flags provided instead of prompting
}

/**
 * Updates to apply to a package manifest
 */
export interface PackageManifestUpdates {
  name?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  author?: string;
  license?: string;
  homepage?: string;
  private?: boolean;
}

/**
 * Result of the set operation
 */
export interface SetPipelineResult {
  packageName: string;
  packagePath: string;
  sourceType: 'workspace' | 'global' | 'cwd';
  updatedFields: string[];
  manifestPath: string;
}

/**
 * Information about changes to be applied
 */
export interface ConfigChange {
  field: string;
  oldValue: any;
  newValue: any;
}
