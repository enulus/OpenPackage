import { resolve as resolvePath, join } from 'path';

import { exists } from './fs.js';
import { getLocalOpenPackageDir } from './paths.js';

/**
 * Options for resolving source operation arguments.
 */
export interface SourceOperationOptions {
  /** Command name for error messages ('add' | 'remove') */
  command: 'add' | 'remove';
  /** Whether to check workspace root path in addition to filesystem path (for remove) */
  checkWorkspaceRoot?: boolean;
}

/**
 * Resolved source operation result.
 */
export interface ResolvedSourceOperation {
  /** Package name (null = workspace root, string = specific package) */
  resolvedPackageName: string | null;
  /** Path to operate on */
  resolvedPath: string;
}

/**
 * Resolve source operation arguments to determine package name and operation path.
 * 
 * This shared utility handles argument resolution for both add and remove commands:
 * - For add: packageName from --to option, pathArg is source path to add
 * - For remove: packageName from --from option, pathArg is target path to remove
 * 
 * @param cwd - Current working directory
 * @param packageName - Package name from --to/--from option (undefined = workspace root)
 * @param pathArg - Path argument from command line
 * @param options - Command-specific options
 * @returns Resolved package name and path
 * 
 * @example
 * // Add command: opkg add ./file.md --to my-package
 * const result = await resolveSourceOperationArguments(
 *   cwd, 'my-package', './file.md', { command: 'add' }
 * );
 * // => { resolvedPackageName: 'my-package', resolvedPath: './file.md' }
 * 
 * @example
 * // Remove command: opkg remove agents/my-agent
 * const result = await resolveSourceOperationArguments(
 *   cwd, undefined, 'agents/my-agent', { command: 'remove', checkWorkspaceRoot: true }
 * );
 * // Checks both ./agents/my-agent AND .openpackage/agents/my-agent
 * // => { resolvedPackageName: null, resolvedPath: 'agents/my-agent' }
 */
export async function resolveSourceOperationArguments(
  cwd: string,
  packageName: string | undefined,
  pathArg: string | undefined,
  options: SourceOperationOptions
): Promise<ResolvedSourceOperation> {
  const { command, checkWorkspaceRoot = false } = options;
  const flagName = command === 'add' ? '--to' : '--from';
  
  // Two arguments provided: explicit package name + path
  if (packageName && pathArg) {
    return { resolvedPackageName: packageName, resolvedPath: pathArg };
  }

  // One argument provided
  const singleArg = packageName || pathArg;
  if (!singleArg) {
    throw new Error(`Path argument is required for ${command}.`);
  }

  // Check if single arg is a valid path
  const absPath = resolvePath(cwd, singleArg);
  let pathExists = await exists(absPath);
  
  // For remove command, also check workspace root path
  if (!pathExists && checkWorkspaceRoot) {
    const openpackageDir = getLocalOpenPackageDir(cwd);
    const workspaceRootPath = join(openpackageDir, singleArg);
    pathExists = await exists(workspaceRootPath);
  }
  
  if (pathExists) {
    // It's a valid path → operate on workspace root
    return { resolvedPackageName: null, resolvedPath: singleArg };
  }

  // Path doesn't exist. For remove, pass through so the pipeline can try dependency resolution.
  // For add, this would have failed earlier. Only remove uses checkWorkspaceRoot.
  if (checkWorkspaceRoot && command === 'remove') {
    return { resolvedPackageName: null, resolvedPath: singleArg };
  }

  // Not a valid path → treat as package name (error will be thrown later)
  throw new Error(
    `Path '${singleArg}' not found.\n\n` +
    `If you meant to specify a package name, use: opkg ${command} <path> ${flagName} ${singleArg}`
  );
}
