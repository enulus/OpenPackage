/**
 * @fileoverview Main pipeline for the set command
 * 
 * Orchestrates package resolution, manifest updates, and display.
 */

import path from 'path';
import semver from 'semver';

import type { CommandResult, PackageYml } from '../../types/index.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { parsePackageYml, writePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { normalizePackageName, validatePackageName } from '../../utils/package-name.js';
import { ValidationError, UserCancellationError } from '../../utils/errors.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import type { PromptPort } from '../ports/prompt.js';
import { resolvePrompt } from '../ports/resolve.js';
import { 
  displayConfigChanges, 
  displaySetSuccess, 
  displayCurrentConfig,
  displayNoChanges 
} from './set-output.js';
import type { 
  SetCommandOptions, 
  PackageManifestUpdates, 
  SetPipelineResult,
  ConfigChange 
} from './set-types.js';

/**
 * Resolve package source for set operation
 * Priority: provided package name → CWD package
 */
async function resolvePackageForSet(
  cwd: string,
  packageInput?: string
): Promise<{
  packagePath: string;
  packageName: string;
  sourceType: 'workspace' | 'global' | 'cwd';
}> {
  // If package name provided, resolve mutable source
  if (packageInput) {
    const resolved = await resolveMutableSource({
      cwd,
      packageName: packageInput
    });
    
    const sourceType = resolved.absolutePath.includes('.openpackage/packages')
      ? (resolved.absolutePath.includes(cwd) ? 'workspace' as const : 'global' as const)
      : 'cwd' as const;
    
    return {
      packagePath: resolved.absolutePath,
      packageName: resolved.packageName,
      sourceType
    };
  }
  
  // No package name - check CWD
  const manifestPath = path.join(cwd, FILE_PATTERNS.OPENPACKAGE_YML);
  if (!(await exists(manifestPath))) {
    throw new Error(
      'No openpackage.yml found in current directory.\n' +
      'Either specify a package name or run from a package root:\n' +
      '  opkg set <package-name> [options]\n' +
      '  opkg set [options]  # When in package root'
    );
  }
  
  const manifest = await parsePackageYml(manifestPath);
  
  return {
    packagePath: cwd,
    packageName: manifest.name,
    sourceType: 'cwd'
  };
}

/**
 * Validate field values before applying
 */
function validateUpdates(updates: PackageManifestUpdates): void {
  // Validate name
  if (updates.name !== undefined) {
    validatePackageName(updates.name);
  }
  
  // Validate version
  if (updates.version !== undefined) {
    if (!semver.valid(updates.version)) {
      throw new ValidationError(
        `Invalid version format: "${updates.version}"\n` +
        `Version must be valid semver (e.g., 1.0.0, 2.1.3-beta.1)`
      );
    }
  }
  
  // Validate homepage URL format (basic check)
  if (updates.homepage !== undefined && updates.homepage.trim().length > 0) {
    try {
      new URL(updates.homepage);
    } catch {
      throw new ValidationError(
        `Invalid homepage URL: "${updates.homepage}"\n` +
        `Must be a valid URL (e.g., https://example.com)`
      );
    }
  }
}

/**
 * Extract updates from CLI options
 */
function extractUpdatesFromOptions(options: SetCommandOptions): PackageManifestUpdates {
  const updates: PackageManifestUpdates = {};
  
  if (options.name !== undefined) {
    updates.name = normalizePackageName(options.name);
  }
  
  if (options.ver !== undefined) {
    updates.version = options.ver;
  }
  
  if (options.description !== undefined) {
    updates.description = options.description;
  }
  
  if (options.keywords !== undefined) {
    // Parse space-separated keywords into array
    updates.keywords = options.keywords
      .trim()
      .split(/\s+/)
      .filter(k => k.length > 0);
  }
  
  if (options.author !== undefined) {
    updates.author = options.author;
  }
  
  if (options.license !== undefined) {
    updates.license = options.license;
  }
  
  if (options.homepage !== undefined) {
    updates.homepage = options.homepage;
  }
  
  if (options.private !== undefined) {
    updates.private = options.private;
  }
  
  return updates;
}

/**
 * Prompt user for updates interactively
 */
async function promptPackageUpdates(
  currentConfig: PackageYml,
  prm: PromptPort
): Promise<PackageManifestUpdates> {
  displayCurrentConfig(currentConfig, '');
  
  const name = await prm.text('Package name:', {
    initial: currentConfig.name,
    validate: (value: string) => {
      if (!value) return 'Name is required';
      try {
        validatePackageName(value);
      } catch (error) {
        const message = (error as Error).message;
        return message.replace(/^Validation error:\s*/, '');
      }
      return true;
    }
  });
  
  const version = await prm.text('Version:', {
    initial: currentConfig.version || '',
    validate: (value: string) => {
      if (!value) return true; // Allow empty (will keep current)
      if (!semver.valid(value)) {
        return 'Version must be valid semver (e.g., 1.0.0)';
      }
      return true;
    }
  });
  
  const description = await prm.text('Description:', {
    initial: currentConfig.description || ''
  });
  
  const keywords = await prm.text('Keywords (space-separated):', {
    initial: currentConfig.keywords ? currentConfig.keywords.join(' ') : ''
  });
  
  const author = await prm.text('Author:', {
    initial: currentConfig.author || ''
  });
  
  const license = await prm.text('License:', {
    initial: currentConfig.license || ''
  });
  
  const homepage = await prm.text('Homepage:', {
    initial: currentConfig.homepage || '',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return 'Must be a valid URL';
      }
    }
  });
  
  const isPrivate = await prm.confirm('Private package?', currentConfig.private || false);
  
  // Build updates object only for changed fields
  const updates: PackageManifestUpdates = {};
  
  // Normalize name for comparison
  const normalizedName = normalizePackageName(name);
  if (normalizedName !== currentConfig.name) {
    updates.name = normalizedName;
  }
  
  if (version && version !== currentConfig.version) {
    updates.version = version;
  }
  
  if (description !== (currentConfig.description || '')) {
    updates.description = description || undefined;
  }
  
  // Parse and compare keywords
  const newKeywords = keywords
    ? keywords.trim().split(/\s+/).filter((k: string) => k.length > 0)
    : [];
  const currentKeywords = currentConfig.keywords || [];
  if (JSON.stringify(newKeywords) !== JSON.stringify(currentKeywords)) {
    updates.keywords = newKeywords.length > 0 ? newKeywords : undefined;
  }
  
  if (author !== (currentConfig.author || '')) {
    updates.author = author || undefined;
  }
  
  if (license !== (currentConfig.license || '')) {
    updates.license = license || undefined;
  }
  
  if (homepage !== (currentConfig.homepage || '')) {
    updates.homepage = homepage || undefined;
  }
  
  if (isPrivate !== (currentConfig.private || false)) {
    updates.private = isPrivate;
  }
  
  return updates;
}

/**
 * Detect changes between current config and updates
 */
function detectChanges(
  currentConfig: PackageYml,
  updates: PackageManifestUpdates
): ConfigChange[] {
  const changes: ConfigChange[] = [];
  
  for (const [field, newValue] of Object.entries(updates)) {
    const oldValue = currentConfig[field as keyof PackageYml];
    
    // Deep comparison for arrays
    if (Array.isArray(newValue) && Array.isArray(oldValue)) {
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({ field, oldValue, newValue });
      }
    } else if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }
  
  return changes;
}

/**
 * Apply updates to manifest configuration
 */
function applyUpdates(
  currentConfig: PackageYml,
  updates: PackageManifestUpdates
): PackageYml {
  return {
    ...currentConfig,
    ...updates
  };
}

/**
 * Run the set pipeline
 */
export async function runSetPipeline(
  packageInput: string | undefined,
  options: SetCommandOptions = {},
  prompt?: PromptPort
): Promise<CommandResult<SetPipelineResult>> {
  const cwd = process.cwd();
  const prm = prompt ?? resolvePrompt();
  
  try {
    // Step 1: Validate inputs
    const hasFieldFlags = Boolean(
      options.ver || 
      options.name || 
      options.description !== undefined ||
      options.keywords !== undefined || 
      options.author !== undefined || 
      options.license !== undefined || 
      options.homepage !== undefined || 
      options.private !== undefined
    );
    
    const isInteractive = !options.nonInteractive && !hasFieldFlags;
    
    if (options.nonInteractive && !hasFieldFlags) {
      throw new ValidationError(
        'Non-interactive mode requires at least one field flag.\n' +
        'Available flags: --ver, --name, --description, --keywords, --author, --license, --homepage, --private\n' +
        'Example: opkg set my-package --ver 1.0.0 --non-interactive'
      );
    }
    
    logger.debug('Starting set pipeline', { packageInput, options, isInteractive });
    
    // Step 2: Resolve package source
    const resolved = await resolvePackageForSet(cwd, packageInput);
    
    logger.info('Package resolved for set', {
      packageName: resolved.packageName,
      packagePath: resolved.packagePath,
      sourceType: resolved.sourceType
    });
    
    // Step 3: Load current manifest
    const manifestPath = path.join(resolved.packagePath, FILE_PATTERNS.OPENPACKAGE_YML);
    const currentConfig = await parsePackageYml(manifestPath);
    
    // Step 4: Determine updates
    let updates: PackageManifestUpdates;
    
    if (isInteractive) {
      updates = await promptPackageUpdates(currentConfig, prm);
    } else {
      updates = extractUpdatesFromOptions(options);
    }
    
    // Step 5: Detect changes
    const changes = detectChanges(currentConfig, updates);
    
    if (changes.length === 0) {
      displayNoChanges(resolved.packageName);
      return {
        success: true,
        data: {
          packageName: resolved.packageName,
          packagePath: resolved.packagePath,
          sourceType: resolved.sourceType,
          updatedFields: [],
          manifestPath
        }
      };
    }
    
    // Step 6: Validate updates
    validateUpdates(updates);
    
    // Step 7: Show changes and confirm (unless force mode)
    displayConfigChanges(changes);
    
    if (!options.force && isInteractive) {
      const confirmed = await prm.confirm('Apply these changes?', true);
      if (!confirmed) {
        throw new UserCancellationError();
      }
    }
    
    // Step 8: Apply updates
    const updatedConfig = applyUpdates(currentConfig, updates);
    
    // Step 9: Write manifest
    await writePackageYml(manifestPath, updatedConfig);
    
    logger.info('Manifest updated successfully', {
      packageName: resolved.packageName,
      updatedFields: changes.map(c => c.field)
    });
    
    // Step 10: Display success
    const result: SetPipelineResult = {
      packageName: resolved.packageName,
      packagePath: resolved.packagePath,
      sourceType: resolved.sourceType,
      updatedFields: changes.map(c => c.field),
      manifestPath
    };
    
    displaySetSuccess(result, cwd);
    
    return {
      success: true,
      data: result
    };
    
  } catch (error) {
    if (error instanceof UserCancellationError) {
      throw error;
    }
    
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Set pipeline failed', { error: message });
    
    return {
      success: false,
      error: message
    };
  }
}
