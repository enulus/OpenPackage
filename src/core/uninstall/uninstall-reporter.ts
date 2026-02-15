import { box, note } from '@clack/prompts';
import { formatPathForDisplay } from '../../utils/formatters.js';

export interface UninstallResult {
  packageName: string;
  removedFiles: string[];
  rootFilesUpdated: string[];
}

/**
 * Report uninstall results to console
 */
export function reportUninstallResult(result: UninstallResult): void {
  const summaryParts: string[] = [];
  
  if (result.removedFiles.length > 0) {
    summaryParts.push(`Removed files: ${result.removedFiles.length}`);
  }
  
  if (result.rootFilesUpdated.length > 0) {
    summaryParts.push(`Updated root files: ${result.rootFilesUpdated.length}`);
  }
  
  const content = summaryParts.length > 0 ? summaryParts.join('\n') : 'No changes';
  
  box(content, `✓ ${result.packageName}`);
  
  if (result.removedFiles.length > 0) {
    const sortedFiles = [...result.removedFiles].sort((a, b) => a.localeCompare(b));
    const displayFiles = sortedFiles.map(f => formatPathForDisplay(f));
    const fileList = displayFiles.slice(0, 3).join('\n') + 
      (displayFiles.length > 3 ? `\n... and ${displayFiles.length - 3} more` : '');
    note(fileList, 'Removed Files');
  }
  
  if (result.rootFilesUpdated.length > 0) {
    const sortedFiles = [...result.rootFilesUpdated].sort((a, b) => a.localeCompare(b));
    const displayFiles = sortedFiles.map(f => `${formatPathForDisplay(f)} (updated)`);
    const fileList = displayFiles.slice(0, 3).join('\n') + 
      (displayFiles.length > 3 ? `\n... and ${displayFiles.length - 3} more` : '');
    note(fileList, 'Updated Root Files');
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
export function reportResourceUninstallResult(result: ResourceUninstallResult): void {
  const fromPkg = result.packageName ? ` from ${result.packageName}` : '';
  const fileCount = result.removedFiles.length;
  const content = `Type: ${result.resourceType}\nFiles removed: ${fileCount}${fromPkg}`;
  
  box(content, `✓ ${result.resourceName}`);
  
  if (result.removedFiles.length > 0) {
    const sortedFiles = [...result.removedFiles].sort((a, b) => a.localeCompare(b));
    const displayFiles = sortedFiles.map(f => formatPathForDisplay(f));
    const fileList = displayFiles.slice(0, 3).join('\n') + 
      (displayFiles.length > 3 ? `\n... and ${displayFiles.length - 3} more` : '');
    note(fileList, 'Removed Files');
  }
  
  if (result.rootFilesUpdated.length > 0) {
    const sortedFiles = [...result.rootFilesUpdated].sort((a, b) => a.localeCompare(b));
    const displayFiles = sortedFiles.map(f => `${formatPathForDisplay(f)} (updated)`);
    const fileList = displayFiles.slice(0, 3).join('\n') + 
      (displayFiles.length > 3 ? `\n... and ${displayFiles.length - 3} more` : '');
    note(fileList, 'Updated Root Files');
  }
}
