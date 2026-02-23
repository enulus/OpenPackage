import { PackageYml } from '../types/index.js';
import { relative, isAbsolute } from 'path';
import { normalizePathWithTilde } from './home-directory.js';
import type { OutputPort } from '../core/ports/output.js';
import { consoleOutput } from '../core/ports/console-output.js';

/**
 * Formatting utilities for consistent display across commands
 */

/**
 * Format a file system path for display to the user.
 * 
 * This function provides a unified way to display paths across all commands:
 * - Uses tilde notation (~) for paths under home directory (e.g., ~/.claude/..., ~/.config/..., ~/.openpackage/...)
 * - Uses relative paths from cwd for paths in the workspace
 * - Falls back to absolute path for other cases
 * 
 * @param path - The path to format (can be absolute or relative)
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Formatted path string for display
 * 
 * @example
 * formatPathForDisplay('/Users/user/.openpackage/packages/my-pkg') // => '~/.openpackage/packages/my-pkg'
 * formatPathForDisplay('/Users/user/.claude/agents/x.md') // => '~/.claude/agents/x.md'
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
  
  // Try relative path from cwd first (paths in workspace take precedence)
  const relativePath = relative(cwd, path);
  if (relativePath && !relativePath.startsWith('..')) {
    // Only use relative path if it's within cwd (doesn't start with ..)
    return relativePath;
  }
  
  // Use tilde notation for any path under home directory (~/.claude, ~/.config, ~/.cursor, ~/.openpackage, etc.)
  const tildePath = normalizePathWithTilde(path);
  if (tildePath.startsWith('~')) {
    return tildePath;
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
export function displayExtendedPackageTable(packages: PackageTableEntry[], output?: OutputPort): void {
  const out = output ?? consoleOutput;
  if (packages.length === 0) {
    out.message('No packages found.');
    return;
  }
  
  // Table header
  out.message('FORMULA'.padEnd(20) + 'INSTALLED'.padEnd(12) + 'STATUS'.padEnd(15) + 'TYPE'.padEnd(15) + 'AVAILABLE');
  out.message('-------'.padEnd(20) + '---------'.padEnd(12) + '------'.padEnd(15) + '----'.padEnd(15) + '---------');
  
  // Display each package
  for (const pkg of packages) {
    const name = pkg.name.padEnd(20);
    const version = pkg.version.padEnd(12);
    const status = (pkg.status || '').padEnd(15);
    const type = (pkg.type || '').padEnd(15);
    const available = (pkg.available || '-').padEnd(9);
    
    out.message(`${name}${version}${status}${type}${available}`);
  }
  
  out.message('');
  out.message(`Total: ${packages.length} packages`);
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
  title?: string,
  output?: OutputPort
): void {
  const out = output ?? consoleOutput;
  if (title) {
    out.message(title);
    out.message('');
  }
  
  if (items.length === 0) {
    out.message('No items found.');
    return;
  }
  
  // Build header
  const headerLine = columns.map(col => col.header.padEnd(col.width)).join('');
  const separatorLine = columns.map(col => '-'.repeat(col.header.length).padEnd(col.width)).join('');
  
  out.message(headerLine);
  out.message(separatorLine);
  
  // Display rows
  for (const item of items) {
    const row = columns.map(col => col.accessor(item).padEnd(col.width)).join('');
    out.message(row);
  }
  
  out.message('');
  out.message(`Total: ${items.length} items`);
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
 * Format a single scope as a tag.
 * Only [global] is shown — [project] is the default context and omitted to reduce noise.
 */
export function formatScopeTag(scope: string): string {
  return scope === 'global' ? ' [global]' : '';
}

/**
 * Format one or more scopes as a badge.
 * Only [global] is shown — [project] is the default context and omitted to reduce noise.
 */
export function formatScopeBadge(scopes: Set<string> | string): string {
  if (typeof scopes === 'string') {
    return scopes === 'global' ? '[global]' : '';
  }
  const hasGlobal = scopes.has('global');
  return hasGlobal ? '[global]' : '';
}

/**
 * Display package configuration details in a consistent format
 */
export function displayPackageConfig(packageConfig: PackageYml, path: string, isExisting: boolean = false, output?: OutputPort): void {
  const out = output ?? consoleOutput;
  const action = isExisting ? 'already exists' : 'created';
  const displayPath = formatPathForDisplay(path);
  
  out.success(`${displayPath} ${action}`);

  out.message(`  Name: ${packageConfig.name}`);
  if (packageConfig.version) {
    out.message(`  Version: ${packageConfig.version}`);
  }
  if (packageConfig.description) {
    out.message(`  Description: ${packageConfig.description}`);
  }
  if (packageConfig.keywords && packageConfig.keywords.length > 0) {
    out.message(`  Keywords: ${packageConfig.keywords.join(', ')}`);
  }
  if (packageConfig.private) {
    out.message(`  Private: Yes`);
  }
}
