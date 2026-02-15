/**
 * Interactive Package Selector
 * 
 * Provides interactive package selection from available packages in .openpackage/packages/
 */

import { select } from '@clack/prompts';
import { getLocalPackagesDir, getLocalOpenPackageDir } from './paths.js';
import { exists, listDirectories } from './fs.js';
import { logger } from './logger.js';
import { join } from 'path';
import { FILE_PATTERNS } from '../constants/index.js';

/**
 * Options for interactive package selection
 */
export interface PackageSelectionOptions {
  /** Base directory (workspace root) */
  cwd: string;
  
  /** Prompt message to display */
  message?: string;
  
  /** Include workspace package as an option (default: true) */
  allowWorkspace?: boolean;
}

/**
 * Package option for the selector
 */
interface PackageOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Special value to represent the workspace package
 */
export const WORKSPACE_PACKAGE = '__workspace__';

/**
 * Display an interactive package selector
 * 
 * @param options - Selection options
 * @returns Selected package name, WORKSPACE_PACKAGE for workspace, or null if cancelled
 * 
 * @example
 * const packageName = await interactivePackageSelect({ 
 *   cwd: process.cwd(),
 *   allowWorkspace: true 
 * });
 * 
 * if (packageName === WORKSPACE_PACKAGE) {
 *   // Handle workspace package
 * } else if (packageName) {
 *   // Handle regular package
 * } else {
 *   // User cancelled
 * }
 */
export async function interactivePackageSelect(
  options: PackageSelectionOptions
): Promise<string | null> {
  const {
    cwd,
    message = 'Select a package',
    allowWorkspace = true
  } = options;
  
  try {
    const packages = await getAvailablePackages(cwd);
    
    // Check if we have any packages
    if (packages.length === 0 && !allowWorkspace) {
      logger.warn('No packages found');
      return null;
    }
    
    // Build options list
    const packageOptions: PackageOption[] = [];
    
    // Add workspace package option if allowed
    if (allowWorkspace) {
      packageOptions.push({
        value: WORKSPACE_PACKAGE,
        label: 'workspace package',
        hint: 'Files in .openpackage/'
      });
    }
    
    // Add regular packages
    for (const pkg of packages) {
      packageOptions.push({
        value: pkg,
        label: pkg,
        hint: `Package in .openpackage/packages/${pkg}`
      });
    }
    
    if (packageOptions.length === 0) {
      logger.warn('No packages available for selection');
      return null;
    }
    
    // Show selection prompt
    const selected = await select({
      message,
      options: packageOptions.map(opt => ({
        value: opt.value,
        label: opt.label,
        hint: opt.hint
      }))
    });
    
    // Handle cancellation
    if (typeof selected === 'symbol') {
      logger.debug('Package selection cancelled');
      return null;
    }
    
    logger.debug(`User selected package: ${selected}`);
    return selected as string;
    
  } catch (error) {
    logger.error('Error during package selection', { error });
    throw new Error(`Package selection failed: ${error}`);
  }
}

/**
 * Get list of available packages in .openpackage/packages/
 * 
 * @param cwd - Workspace root directory
 * @returns Array of package names
 */
async function getAvailablePackages(cwd: string): Promise<string[]> {
  const packagesDir = getLocalPackagesDir(cwd);
  
  // Check if packages directory exists
  if (!(await exists(packagesDir))) {
    logger.debug('Packages directory does not exist', { packagesDir });
    return [];
  }
  
  try {
    // List all directories in packages/
    const dirs = await listDirectories(packagesDir);
    
    // Filter to only include directories with openpackage.yml
    const packages: string[] = [];
    
    for (const dir of dirs) {
      const packageYmlPath = join(packagesDir, dir, FILE_PATTERNS.OPENPACKAGE_YML);
      
      // Check if this is a scoped package directory (@scope)
      if (dir.startsWith('@')) {
        // List packages inside the scope directory
        const scopeDir = join(packagesDir, dir);
        const scopedPackages = await listDirectories(scopeDir);
        
        for (const scopedPkg of scopedPackages) {
          const scopedYmlPath = join(scopeDir, scopedPkg, FILE_PATTERNS.OPENPACKAGE_YML);
          if (await exists(scopedYmlPath)) {
            packages.push(`${dir}/${scopedPkg}`);
          }
        }
      } else if (await exists(packageYmlPath)) {
        packages.push(dir);
      }
    }
    
    // Sort packages alphabetically
    packages.sort((a, b) => a.localeCompare(b));
    
    logger.debug(`Found ${packages.length} packages`, { packages });
    return packages;
    
  } catch (error) {
    logger.error('Error scanning packages directory', { error, packagesDir });
    return [];
  }
}

/**
 * Resolve package name and directory from selection result
 * 
 * @param cwd - Workspace root directory
 * @param selection - Result from interactivePackageSelect()
 * @returns Package name (or null for workspace) and absolute directory path
 */
export function resolvePackageSelection(
  cwd: string,
  selection: string | null
): { packageName: string | null; packageDir: string } | null {
  if (!selection) {
    return null;
  }
  
  if (selection === WORKSPACE_PACKAGE) {
    return {
      packageName: null,
      packageDir: getLocalOpenPackageDir(cwd)
    };
  }
  
  return {
    packageName: selection,
    packageDir: join(getLocalPackagesDir(cwd), selection)
  };
}
