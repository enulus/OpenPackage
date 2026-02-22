import { join } from 'path';
import { getOpenPackageDirectories } from '../core/directory.js';
import { DIR_PATTERNS, OPENPACKAGE_DIRS } from '../constants/index.js';
import { normalizePackageName, SCOPED_PACKAGE_REGEX } from './package-name.js';

/**
 * Package scope types
 * - root: Current directory (cwd) as a package
 * - project: Workspace-scoped package in .openpackage/packages/
 * - global: User-scoped package in ~/.openpackage/packages/
 */
export type PackageScope = 'root' | 'project' | 'global';

/**
 * Get the package directory for a given scope
 * 
 * @param cwd - Current working directory
 * @param scope - Package scope
 * @param packageName - Package name (required for project/global, ignored for root)
 * @param customPath - Optional custom path (overrides scope-based resolution)
 * @returns Absolute path to package directory
 */
export function getScopePackageDir(
  cwd: string,
  scope: PackageScope,
  packageName?: string,
  customPath?: string
): string {
  // Custom path takes precedence over scope
  if (customPath) {
    // Note: This is a simple delegation - full validation happens elsewhere
    // This function just returns the path for consistency with the API
    return customPath;
  }

  if (scope === 'root') {
    // Root scope: current directory is the package
    return cwd;
  }

  if (!packageName) {
    throw new Error(`Package name is required for ${scope} scope`);
  }

  const normalizedName = normalizePackageName(packageName);

  if (scope === 'project') {
    // Project scope: .openpackage/packages/<name>/
    return getScopedPackagePath(
      join(cwd, DIR_PATTERNS.OPENPACKAGE, OPENPACKAGE_DIRS.PACKAGES),
      normalizedName
    );
  }

  if (scope === 'global') {
    // Global scope: ~/.openpackage/packages/<name>/
    const dirs = getOpenPackageDirectories();
    return getScopedPackagePath(
      join(dirs.data, OPENPACKAGE_DIRS.PACKAGES),
      normalizedName
    );
  }

  throw new Error(`Invalid scope: ${scope}`);
}

/**
 * Get the openpackage.yml path for a given scope
 * 
 * @param cwd - Current working directory
 * @param scope - Package scope
 * @param packageName - Package name (required for project/global, ignored for root)
 * @param customPath - Optional custom path (overrides scope-based resolution)
 * @returns Absolute path to openpackage.yml
 */
export function getScopePackageYmlPath(
  cwd: string,
  scope: PackageScope,
  packageName?: string,
  customPath?: string
): string {
  const packageDir = getScopePackageDir(cwd, scope, packageName, customPath);
  return join(packageDir, 'openpackage.yml');
}

/**
 * Get a human-readable description of the scope
 * 
 * @param scope - Package scope
 * @returns Description string
 */
export function getScopeDescription(scope: PackageScope): string {
  switch (scope) {
    case 'root':
      return 'Current directory (root package)';
    case 'project':
      return 'Project-scoped (.openpackage/packages/)';
    case 'global':
      return 'Global shared (~/.openpackage/packages/)';
    default:
      return 'Unknown scope';
  }
}

/**
 * Get the relative display path for a scope
 * Used in CLI output to show where package will be created
 * 
 * @param scope - Package scope
 * @param packageName - Package name (optional)
 * @param customPath - Optional custom path for display
 * @returns Display path string
 */
export function getScopeDisplayPath(
  scope: PackageScope,
  packageName?: string,
  customPath?: string
): string {
  if (customPath) {
    return customPath;
  }

  if (scope === 'root') {
    return './openpackage.yml';
  }

  if (!packageName) {
    return scope === 'project'
      ? './.openpackage/packages/<package-name>/'
      : '~/.openpackage/packages/<package-name>/';
  }

  const normalizedName = normalizePackageName(packageName);
  return scope === 'project'
    ? `./.openpackage/packages/${normalizedName}/`
    : `~/.openpackage/packages/${normalizedName}/`;
}

/**
 * Workspace scope for list/uninstall/view (project or global only, no root)
 */
export type WorkspaceScope = 'project' | 'global';

/**
 * Parse and validate workspace scope from CLI (project or global only)
 * Used by list, uninstall, view - rejects root scope.
 *
 * @param scopeValue - Raw scope value from CLI option
 * @returns Validated WorkspaceScope
 */
export function parseWorkspaceScope(scopeValue: string): WorkspaceScope {
  const parsed = parseScope(scopeValue);
  if (parsed === 'root') {
    throw new Error('root scope not supported; use project or global');
  }
  return parsed;
}

/**
 * Parse and validate scope option from CLI
 * 
 * @param scopeValue - Raw scope value from CLI option
 * @returns Validated PackageScope
 */
export function parseScope(scopeValue: string): PackageScope {
  const normalized = scopeValue.toLowerCase().trim();

  if (normalized === 'root' || normalized === 'r') {
    return 'root';
  }

  if (normalized === 'project' || normalized === 'p') {
    return 'project';
  }

  if (normalized === 'global' || normalized === 'g') {
    return 'global';
  }

  throw new Error(
    `Invalid scope: '${scopeValue}'\n` +
    `Valid scopes: root, project, global`
  );
}

/**
 * Helper to get the package path handling scoped packages (@scope/name)
 * Scoped packages get nested directory structure: @scope/name/
 */
function getScopedPackagePath(baseDir: string, packageName: string): string {
  const scopedMatch = packageName.match(SCOPED_PACKAGE_REGEX);
  if (scopedMatch) {
    const [, scope, localName] = scopedMatch;
    return join(baseDir, '@' + scope, localName);
  }
  return join(baseDir, packageName);
}
