import { PackageYml } from '../types/index.js';
import { toTildePath } from './path-resolution.js';
import { relative, isAbsolute } from 'path';

/**
 * Formatting utilities for consistent display across commands
 */

/**
 * Format a file system path for display to the user.
 * 
 * This function provides a unified way to display paths across all commands:
 * - Uses tilde notation (~) for paths under home directory (e.g., ~/.openpackage/packages/...)
 * - Uses relative paths from cwd for paths in the workspace
 * - Falls back to absolute path for other cases
 * 
 * @param path - The path to format (can be absolute or relative)
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Formatted path string for display
 * 
 * @example
 * formatPathForDisplay('/Users/user/.openpackage/packages/my-pkg') // => '~/.openpackage/packages/my-pkg'
 * formatPathForDisplay('/Users/user/workspace/file.txt', '/Users/user/workspace') // => 'file.txt'
 * formatPathForDisplay('./relative/path.txt') // => './relative/path.txt'
 */
export function formatPathForDisplay(path: string, cwd: string = process.cwd()): string {
  // If path is already in tilde notation, return as-is
  if (path.startsWith('~')) {
    return path;
  }
  
  // If path is relative, return as-is
  if (!isAbsolute(path)) {
    return path;
  }
  
  // Try tilde notation first (for paths under ~/.openpackage/)
  const tildePath = toTildePath(path);
  if (tildePath.startsWith('~')) {
    return tildePath;
  }
  
  // Try relative path from cwd
  const relativePath = relative(cwd, path);
  if (relativePath && !relativePath.startsWith('..')) {
    // Only use relative path if it's within cwd (doesn't start with ..)
    return relativePath;
  }
  
  // Fall back to absolute path
  return path;
}

/**
 * Interface for package table entries
 */
export interface PackageTableEntry {
  name: string;
  version: string;
  description?: string;
  status?: string;
  type?: string;
  available?: string;
}

/**
 * Format and display an extended package table with status information (used by list command)
 */
export function displayExtendedPackageTable(packages: PackageTableEntry[]): void {
  if (packages.length === 0) {
    console.log('No packages found.');
    return;
  }
  
  // Table header
  console.log('FORMULA'.padEnd(20) + 'INSTALLED'.padEnd(12) + 'STATUS'.padEnd(15) + 'TYPE'.padEnd(15) + 'AVAILABLE');
  console.log('-------'.padEnd(20) + '---------'.padEnd(12) + '------'.padEnd(15) + '----'.padEnd(15) + '---------');
  
  // Display each package
  for (const pkg of packages) {
    const name = pkg.name.padEnd(20);
    const version = pkg.version.padEnd(12);
    const status = (pkg.status || '').padEnd(15);
    const type = (pkg.type || '').padEnd(15);
    const available = (pkg.available || '-').padEnd(9);
    
    console.log(`${name}${version}${status}${type}${available}`);
  }
  
  console.log('');
  console.log(`Total: ${packages.length} packages`);
}

/**
 * Generic table formatter for custom column layouts
 */
export function displayCustomTable<T>(
  items: T[],
  columns: Array<{
    header: string;
    width: number;
    accessor: (item: T) => string;
  }>,
  title?: string
): void {
  if (title) {
    console.log(title);
    console.log('');
  }
  
  if (items.length === 0) {
    console.log('No items found.');
    return;
  }
  
  // Build header
  const headerLine = columns.map(col => col.header.padEnd(col.width)).join('');
  const separatorLine = columns.map(col => '-'.repeat(col.header.length).padEnd(col.width)).join('');
  
  console.log(headerLine);
  console.log(separatorLine);
  
  // Display rows
  for (const item of items) {
    const row = columns.map(col => col.accessor(item).padEnd(col.width)).join('');
    console.log(row);
  }
  
  console.log('');
  console.log(`Total: ${items.length} items`);
}

/**
 * Format project summary line
 */
export function formatProjectSummary(name: string, version: string): string {
  return `${name}@${version}`;
}

/**
 * Format tree connector symbols
 */
export function getTreeConnector(isLast: boolean): string {
  return isLast ? '└── ' : '├── ';
}

/**
 * Format tree prefix for nested items
 */
export function getTreePrefix(prefix: string, isLast: boolean): string {
  return prefix + (isLast ? '    ' : '│   ');
}

/**
 * Format status with appropriate emoji
 */
export function formatStatus(status: string): string {
  switch (status.toLowerCase()) {
    case 'installed':
      return '✅ installed';
    case 'missing':
      return '❌ missing';
    case 'outdated':
      return '⚠️  outdated';
    case 'dependency-mismatch':
      return '🔄 mismatch';
    default:
      return status;
  }
}

/**
 * Format file count with appropriate description
 */
export function formatFileCount(count: number, type: string = 'files'): string {
  return `${count} ${count === 1 ? type.slice(0, -1) : type}`;
}

/**
 * Format dependency list for display
 */
export function formatDependencyList(dependencies: Array<{ name: string; version: string }>): string[] {
  return dependencies.map(dep => `${dep.name}@${dep.version}`);
}

/**
 * Format file size in appropriate units (KB or MB)
 */
export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(2)}MB`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(2)}KB`;
}

/**
 * Format a single scope as a tag (e.g., " [global]" or " [project]")
 */
export function formatScopeTag(scope: string): string {
  return scope === 'global' ? ' [global]' : ' [project]';
}

/**
 * Format one or more scopes as a badge (e.g., "[project]", "[global]", or "[project, global]")
 */
export function formatScopeBadge(scopes: Set<string> | string): string {
  if (typeof scopes === 'string') {
    return scopes === 'global' ? '[global]' : '[project]';
  }
  const sorted = Array.from(scopes).sort();
  const badges = sorted.map(s => s === 'project' ? 'project' : 'global').join(', ');
  return `[${badges}]`;
}

/**
 * Display package configuration details in a consistent format
 */
export function displayPackageConfig(packageConfig: PackageYml, path: string, isExisting: boolean = false): void {
  const action = isExisting ? 'already exists' : 'created';
  const displayPath = formatPathForDisplay(path);
  
  console.log(`✓ ${displayPath} ${action}`);

  console.log(`  - Name: ${packageConfig.name}`);
  if (packageConfig.version) {
    console.log(`  - Version: ${packageConfig.version}`);
  }
  if (packageConfig.description) {
    console.log(`  - Description: ${packageConfig.description}`);
  }
  if (packageConfig.keywords && packageConfig.keywords.length > 0) {
    console.log(`  - Keywords: ${packageConfig.keywords.join(', ')}`);
  }
  if (packageConfig.private) {
    console.log(`  - Private: Yes`);
  }
}
