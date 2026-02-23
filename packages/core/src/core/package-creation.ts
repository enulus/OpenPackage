import { basename } from 'path';
import type { PackageYml } from '../types/index.js';
import type { PackageScope } from './scope-resolution.js';
import {
  getScopePackageDir,
  getScopePackageYmlPath,
  getScopeDisplayPath,
  getScopeDescription
} from './scope-resolution.js';
import {
  resolveCustomPath,
  validateCustomPath,
  formatCustomPathForDisplay
} from '../utils/custom-path-resolution.js';
import { parsePackageYml, writePackageYml } from '../utils/package-yml.js';
import { logger } from '../utils/logger.js';
import { displayPackageConfig } from '../utils/formatters.js';
import { exists, ensureDir } from '../utils/fs.js';
import { normalizePackageName, validatePackageName } from '../utils/package-name.js';
import type { PackageContext } from './package-context.js';
import type { OutputPort } from './ports/output.js';
import { resolveOutput } from './ports/resolve.js';

/**
 * Options for creating a new package
 */
export interface CreatePackageOptions {
  /** Current working directory */
  cwd: string;

  /** Package scope (root, project, or global) - optional when customPath is provided */
  scope?: PackageScope;

  /** Custom directory path for package - overrides scope-based resolution */
  customPath?: string;

  /** Package name (optional for root scope, required for project/global) */
  packageName?: string;

  /** Force overwrite existing package */
  force?: boolean;
}

/**
 * Result of package creation
 */
export interface CreatePackageResult {
  /** Whether the operation was successful */
  success: boolean;

  /** Package context if successful */
  context?: PackageContext;

  /** Error message if unsuccessful */
  error?: string;

  /** Whether the package already existed (and was kept/overwritten) */
  wasExisting?: boolean;
}

/**
 * Create a new package with the specified scope and options
 * 
 * This is the core package creation logic that handles:
 * - Validation of package name and scope
 * - Conflict detection with existing packages
 * - Directory structure creation
 * - openpackage.yml writing
 * 
 * @param options - Package creation options
 * @returns Result containing success status and package context
 */
export async function createPackage(
  options: CreatePackageOptions,
  output?: OutputPort
): Promise<CreatePackageResult> {
  const out = output ?? resolveOutput();
  const {
    cwd,
    scope,
    customPath,
    packageName,
    force = false
  } = options;

  try {
    // Validate that either scope or customPath is provided
    if (!scope && !customPath) {
      return {
        success: false,
        error: 'Either scope or customPath must be provided'
      };
    }

    // Step 1: Determine initial package name
    let normalizedName: string;
    let displayName: string;

    if (!packageName) {
      // No name provided - package name is required for non-root scopes
      if (scope && scope !== 'root' && !customPath) {
        return {
          success: false,
          error: `Package name is required for ${scope} scope.\nUsage: opkg new <package-name> --scope ${scope}`
        };
      }
      // Use cwd basename as default for root scope
      displayName = basename(cwd);
      normalizedName = normalizePackageName(displayName);
    } else {
      // Package name provided
      validatePackageName(packageName);
      normalizedName = normalizePackageName(packageName);
      displayName = packageName;
    }

    // Step 2: Resolve target paths
    let packageDir: string;
    let packageYmlPath: string;
    let displayPath: string;
    let isCustomPath = false;

    if (customPath) {
      // Custom path provided - resolve and validate
      const resolved = resolveCustomPath(customPath, cwd);
      
      // Validate custom path
      const validation = await validateCustomPath(resolved, force);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error
        };
      }
      
      // Log warning if present
      if (validation.warning) {
        logger.warn(validation.warning);
      }
      
      packageDir = resolved.absolute;
      packageYmlPath = resolved.packageYmlPath;
      displayPath = formatCustomPathForDisplay(resolved, cwd);
      isCustomPath = true;
      
      logger.info(`Creating package '${normalizedName}' at custom path: ${packageDir}`);
    } else if (scope) {
      // Scope-based path resolution (existing logic)
      packageDir = getScopePackageDir(cwd, scope, scope === 'root' ? undefined : normalizedName);
      packageYmlPath = getScopePackageYmlPath(cwd, scope, scope === 'root' ? undefined : normalizedName);
      displayPath = getScopeDisplayPath(scope, scope === 'root' ? undefined : normalizedName);
      
      logger.info(`Creating ${scope} package '${normalizedName}' at: ${packageDir}`);
    } else {
      return {
        success: false,
        error: 'Either scope or customPath must be provided'
      };
    }

    // Step 3: Check for existing package
    const existingYml = await exists(packageYmlPath);
    let existingConfig: PackageYml | null = null;

    if (existingYml) {
      try {
        existingConfig = await parsePackageYml(packageYmlPath);
      } catch (error) {
        logger.warn(`Failed to parse existing openpackage.yml: ${error}`);
      }

      if (!force) {
        const errorMsg = existingConfig 
          ? `Package '${normalizedName}' already exists at ${displayPath}. Use --force to overwrite.`
          : `Package already exists at ${displayPath}. Use --force to overwrite.`;
        
        return {
          success: false,
          error: errorMsg,
          wasExisting: true
        };
      }

      logger.info(`Overwriting existing package at ${displayPath} (--force enabled)`);
    }

    // Step 4: Create package config (minimal manifest)
    const packageConfig: PackageYml = {
      name: normalizedName
    };

    // Step 5: Ensure directory structure
    await ensureDir(packageDir);
    logger.debug(`Created package directory: ${packageDir}`);

    // Step 6: Write openpackage.yml
    await writePackageYml(packageYmlPath, packageConfig);
    logger.info(`Created openpackage.yml at ${packageYmlPath}`);

    // Step 7: Display success message
    displayPackageConfig(packageConfig, packageYmlPath, false);

    // Step 8: Show scope info
    if (isCustomPath) {
      out.message(`  Location: Custom path (${displayPath})`);
    } else if (scope) {
      out.message(`  Scope: ${getScopeDescription(scope)}`);
    }

    // Step 9: Return success with context
    return {
      success: true,
      context: {
        name: normalizedName,
        version: packageConfig.version,
        config: packageConfig,
        packageYmlPath,
        packageRootDir: packageDir,
        packageFilesDir: packageDir,
        location: (isCustomPath || (scope && scope === 'root')) ? 'root' : 'nested',
        isCwdPackage: !isCustomPath && scope === 'root',
        isNew: !existingYml
      },
      wasExisting: existingYml
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to create package`, { error: errorMessage, scope, packageName });

    return {
      success: false,
      error: `Failed to create package: ${errorMessage}`
    };
  }
}
