import { resolve, isAbsolute, dirname, join } from 'path';
import { exists, isDirectory } from './fs.js';
import { expandTildePath } from './path-resolution.js';

/**
 * Utilities for custom path resolution and validation
 * 
 * Handles user-specified custom paths for package creation,
 * including validation, normalization, and error reporting.
 */

/**
 * Result of custom path resolution
 */
export interface ResolvedCustomPath {
  /** The original path as provided by the user */
  original: string;
  
  /** The resolved absolute path */
  absolute: string;
  
  /** The parent directory of the resolved path */
  parentDir: string;
  
  /** Path to openpackage.yml that will be created */
  packageYmlPath: string;
}

/**
 * Validation result for custom path
 */
export interface CustomPathValidation {
  /** Whether the path is valid */
  valid: boolean;
  
  /** Error message if invalid */
  error?: string;
  
  /** Warning message (path is valid but has concerns) */
  warning?: string;
}

/**
 * Resolve a custom path to an absolute path
 * 
 * Handles:
 * - Relative paths (resolved from cwd)
 * - Absolute paths (used as-is)
 * - Tilde paths (expanded to home directory)
 * 
 * @param customPath - The custom path provided by user
 * @param cwd - Current working directory for relative path resolution
 * @returns Resolved path information
 */
export function resolveCustomPath(
  customPath: string,
  cwd: string
): ResolvedCustomPath {
  // Expand tilde if present
  const expandedPath = customPath.startsWith('~')
    ? expandTildePath(customPath)
    : customPath;
  
  // Resolve to absolute path
  const absolutePath = isAbsolute(expandedPath)
    ? resolve(expandedPath)
    : resolve(cwd, expandedPath);
  
  return {
    original: customPath,
    absolute: absolutePath,
    parentDir: dirname(absolutePath),
    packageYmlPath: join(absolutePath, 'openpackage.yml')
  };
}

/**
 * Validate a custom path for package creation
 * 
 * Checks:
 * - Path is not empty
 * - Parent directory exists or can be created
 * - Path doesn't conflict with critical system paths
 * - Path has reasonable structure
 * 
 * @param resolved - Resolved custom path information
 * @param force - Whether --force flag is set
 * @returns Validation result
 */
export async function validateCustomPath(
  resolved: ResolvedCustomPath,
  force: boolean = false
): Promise<CustomPathValidation> {
  const { original, absolute, parentDir, packageYmlPath } = resolved;
  
  // Check for empty path
  if (!original || original.trim() === '') {
    return {
      valid: false,
      error: 'Path cannot be empty'
    };
  }
  
  // Check for dangerous paths
  const dangerousPathCheck = checkDangerousPath(absolute);
  if (!dangerousPathCheck.valid) {
    return dangerousPathCheck;
  }
  
  // Check if parent directory exists
  const parentExists = await exists(parentDir);
  if (!parentExists) {
    return {
      valid: false,
      error: `Parent directory does not exist: ${parentDir}\n` +
             `Please create it first or choose a different path.`
    };
  }
  
  // Check if parent is actually a directory
  const parentIsDir = await isDirectory(parentDir);
  if (!parentIsDir) {
    return {
      valid: false,
      error: `Parent path exists but is not a directory: ${parentDir}`
    };
  }
  
  // Check if package directory already exists
  const targetExists = await exists(absolute);
  if (targetExists) {
    const targetIsDir = await isDirectory(absolute);
    if (!targetIsDir) {
      return {
        valid: false,
        error: `Path exists but is not a directory: ${absolute}`
      };
    }
    
    // Check if openpackage.yml already exists
    const ymlExists = await exists(packageYmlPath);
    if (ymlExists && !force) {
      return {
        valid: false,
        error: `Package already exists at: ${absolute}\n` +
               `Use --force to overwrite.`
      };
    }
    
    // Directory exists, will be used or overwritten
    if (ymlExists && force) {
      return {
        valid: true,
        warning: `Overwriting existing package at: ${absolute}`
      };
    }
  }
  
  return { valid: true };
}

/**
 * Check if a path is dangerous or conflicts with critical system paths
 * 
 * @param absolutePath - The absolute path to check
 * @returns Validation result
 */
function checkDangerousPath(absolutePath: string): CustomPathValidation {
  const normalizedPath = absolutePath.toLowerCase();
  
  // Don't allow root directory
  if (absolutePath === '/' || /^[A-Z]:\\?$/.test(absolutePath)) {
    return {
      valid: false,
      error: 'Cannot create package in root directory'
    };
  }
  
  // Don't allow critical system directories
  // Note: We allow temp directories like /tmp and /var/folders (macOS temp)
  const dangerousPaths = [
    '/bin', '/sbin', '/usr', '/etc', '/sys', '/proc', '/dev',
    '/boot', '/lib', '/lib64', '/opt', '/root', '/srv',
    'c:\\windows', 'c:\\program files', 'c:\\program files (x86)'
  ];
  
  for (const dangerous of dangerousPaths) {
    if (normalizedPath === dangerous || normalizedPath.startsWith(dangerous + '/')) {
      // Exception: Allow macOS temp directories in /var/folders
      if (dangerous === '/var' && normalizedPath.includes('/var/folders/')) {
        continue;
      }
      
      return {
        valid: false,
        error: `Cannot create package in system directory: ${absolutePath}`
      };
    }
  }
  
  return { valid: true };
}

/**
 * Format a custom path for display to the user
 * 
 * Shows relative path if it's shorter and clearer,
 * otherwise shows absolute path with tilde expansion for home directory.
 * 
 * @param resolved - Resolved custom path information
 * @param cwd - Current working directory for relative path display
 * @returns Formatted path for display
 */
export function formatCustomPathForDisplay(
  resolved: ResolvedCustomPath,
  cwd: string
): string {
  const { original, absolute } = resolved;
  
  // If original was relative or tilde, prefer showing that
  if (!isAbsolute(original)) {
    return original;
  }
  
  // Otherwise show absolute with potential tilde
  return absolute;
}
