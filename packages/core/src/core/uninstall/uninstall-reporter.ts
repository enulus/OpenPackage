import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';
import { formatPathForDisplay } from '../../utils/formatters.js';

export interface UninstallResult {
  packageName: string;
  removedFiles: string[];
  rootFilesUpdated: string[];
}

/**
 * Report uninstall results to console
 */
export function reportUninstallResult(result: UninstallResult, context?: { interactive?: boolean }, output?: OutputPort): void {
  // Suppress output in interactive mode (spinner handles feedback)
  if (context?.interactive) return;
  
  const out = output ?? resolveOutput();
  const cwd = process.cwd();
  
  // Main success message
  out.success(`Uninstalled ${result.packageName}`);
  
  // Display removed files in tree-style format
  if (result.removedFiles.length > 0) {
    out.success(`Removed files: ${result.removedFiles.length}`);
    const sortedFiles = [...result.removedFiles].sort((a, b) => a.localeCompare(b));
    const displayFiles = sortedFiles.slice(0, 10);
    for (const file of displayFiles) {
      out.info(`   ├── ${formatPathForDisplay(file, cwd)}`);
    }
    if (sortedFiles.length > 10) {
      out.info(`   ... and ${sortedFiles.length - 10} more`);
    }
  }
  
  // Display updated root files in tree-style format
  if (result.rootFilesUpdated.length > 0) {
    out.success(`Updated root files: ${result.rootFilesUpdated.length}`);
    const sortedFiles = [...result.rootFilesUpdated].sort((a, b) => a.localeCompare(b));
    const displayFiles = sortedFiles.slice(0, 10);
    for (const file of displayFiles) {
      out.info(`   ├── ${formatPathForDisplay(file, cwd)}`);
    }
    if (sortedFiles.length > 10) {
      out.info(`   ... and ${sortedFiles.length - 10} more`);
    }
  }
}

export interface ResourceUninstallResult {
  resourceName: string;
  resourceType: string;
  packageName?: string;
  removedFiles: string[];
  rootFilesUpdated: string[];
}

/**
 * Report resource-level uninstall results to console
 */
export function reportResourceUninstallResult(result: ResourceUninstallResult, context?: { interactive?: boolean }, output?: OutputPort): void {
  // Suppress output in interactive mode (spinner handles feedback)
  if (context?.interactive) return;
  
  const out = output ?? resolveOutput();
  const cwd = process.cwd();
  
  // Main success message
  const fromPkg = result.packageName ? ` from ${result.packageName}` : '';
  out.success(`Uninstalled ${result.resourceName}${fromPkg}`);
  
  // Display removed files in tree-style format
  if (result.removedFiles.length > 0) {
    out.success(`Removed files: ${result.removedFiles.length}`);
    const sortedFiles = [...result.removedFiles].sort((a, b) => a.localeCompare(b));
    const displayFiles = sortedFiles.slice(0, 10);
    for (const file of displayFiles) {
      out.info(`   ├── ${formatPathForDisplay(file, cwd)}`);
    }
    if (sortedFiles.length > 10) {
      out.info(`   ... and ${sortedFiles.length - 10} more`);
    }
  }
  
  // Display updated root files in tree-style format
  if (result.rootFilesUpdated.length > 0) {
    out.success(`Updated root files: ${result.rootFilesUpdated.length}`);
    const sortedFiles = [...result.rootFilesUpdated].sort((a, b) => a.localeCompare(b));
    const displayFiles = sortedFiles.slice(0, 10);
    for (const file of displayFiles) {
      out.info(`   ├── ${formatPathForDisplay(file, cwd)}`);
    }
    if (sortedFiles.length > 10) {
      out.info(`   ... and ${sortedFiles.length - 10} more`);
    }
  }
}
