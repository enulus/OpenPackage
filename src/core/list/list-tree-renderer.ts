import type { ListResourceGroup, ListResourceInfo, ListFileMapping } from './list-pipeline.js';
import type { ResourceScope } from '../resources/scope-traversal.js';

export type { ResourceScope } from '../resources/scope-traversal.js';

/**
 * Enhanced file mapping with status and scope
 */
export interface EnhancedFileMapping extends ListFileMapping {
  status: 'tracked' | 'untracked' | 'missing';
  scope: ResourceScope;
}

/**
 * Enhanced resource info with status and scopes
 */
export interface EnhancedResourceInfo {
  name: string;
  resourceType: string;
  files: EnhancedFileMapping[];
  status: 'tracked' | 'partial' | 'untracked' | 'mixed';
  scopes: Set<ResourceScope>;
}

/**
 * Enhanced resource group
 */
export interface EnhancedResourceGroup {
  resourceType: string;
  resources: EnhancedResourceInfo[];
}

/**
 * Configuration for tree rendering behavior
 */
export interface TreeRenderConfig<TFile> {
  /** Function to format file path for display */
  formatPath: (file: TFile) => string;
  /** Function to check if file is missing */
  isMissing: (file: TFile) => boolean;
  /** Function to sort files */
  sortFiles: (a: TFile, b: TFile) => number;
  /** Optional badge/suffix for resource names */
  getResourceBadge?: (scopes?: Set<ResourceScope>) => string;
}

// ANSI color codes
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const RED = '\x1b[31m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function red(text: string): string {
  return `${RED}${text}${RESET}`;
}

/**
 * Get tree connector character based on position
 */
export function getTreeConnector(isLast: boolean, hasBranches: boolean): string {
  if (isLast) {
    return hasBranches ? '└─┬ ' : '└── ';
  }
  return hasBranches ? '├─┬ ' : '├── ';
}

/**
 * Calculate child prefix based on parent prefix and position
 */
export function getChildPrefix(parentPrefix: string, isLast: boolean): string {
  return parentPrefix + (isLast ? '  ' : '│ ');
}

/**
 * Format file label with missing indicator if needed
 */
export function formatFileLabel<TFile>(
  file: TFile,
  config: TreeRenderConfig<TFile>
): string {
  const filePath = config.formatPath(file);
  const isMissing = config.isMissing(file);
  
  return isMissing
    ? `${dim(filePath)} ${red('[MISSING]')}`
    : dim(filePath);
}

/**
 * Collect and sort all files from a resource group
 */
export function collectGroupFiles<TFile>(
  group: ListResourceGroup | EnhancedResourceGroup,
  config: TreeRenderConfig<TFile>
): TFile[] {
  const allFiles: TFile[] = [];
  for (const resource of group.resources) {
    allFiles.push(...(resource.files as TFile[]));
  }
  return allFiles.sort(config.sortFiles);
}

/**
 * Render files directly under a group (for 'other' type)
 */
export function renderFlatFileList<TFile>(
  files: TFile[],
  prefix: string,
  config: TreeRenderConfig<TFile>
): void {
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const isLastFile = fi === files.length - 1;
    const fileConnector = getTreeConnector(isLastFile, false);
    const label = formatFileLabel(file, config);
    console.log(`${prefix}${fileConnector}${label}`);
  }
}

/**
 * Render a single resource with its files
 */
export function renderResource<TFile>(
  resource: ListResourceInfo | EnhancedResourceInfo,
  prefix: string,
  isLast: boolean,
  showFiles: boolean,
  config: TreeRenderConfig<TFile>
): void {
  const hasFiles = showFiles && resource.files.length > 0;
  const connector = getTreeConnector(isLast, hasFiles);
  
  // Resource name with optional badge
  const badge = config.getResourceBadge?.(
    (resource as EnhancedResourceInfo).scopes
  ) ?? '';
  console.log(`${prefix}${connector}${resource.name}${badge ? ' ' + badge : ''}`);
  
  // Render files if requested
  if (hasFiles) {
    const childPrefix = getChildPrefix(prefix, isLast);
    const sortedFiles = [...(resource.files as TFile[])].sort(config.sortFiles);
    renderFlatFileList(sortedFiles, childPrefix, config);
  }
}

/**
 * Render a single resource group with all its resources
 */
export function renderResourceGroup<TFile>(
  group: ListResourceGroup | EnhancedResourceGroup,
  prefix: string,
  isLast: boolean,
  showFiles: boolean,
  config: TreeRenderConfig<TFile>
): void {
  const isOtherGroup = group.resourceType === 'other';
  
  if (isOtherGroup) {
    // Flatten: show files directly without resource subcategories
    const allFiles = collectGroupFiles<TFile>(group, config);
    const totalFileCount = allFiles.length;
    const hasFiles = showFiles && allFiles.length > 0;
    
    const connector = getTreeConnector(isLast, hasFiles);
    console.log(`${prefix}${connector}${group.resourceType}${dim(` (${totalFileCount})`)}`);
    
    if (hasFiles) {
      const childPrefix = getChildPrefix(prefix, isLast);
      renderFlatFileList(allFiles, childPrefix, config);
    }
  } else {
    // Normal: show resources as subcategories, then files
    const hasResources = group.resources.length > 0;
    const connector = getTreeConnector(isLast, hasResources);
    const childPrefix = getChildPrefix(prefix, isLast);
    
    console.log(`${prefix}${connector}${group.resourceType}${dim(` (${group.resources.length})`)}`);
    
    for (let ri = 0; ri < group.resources.length; ri++) {
      const resource = group.resources[ri];
      const isLastResource = ri === group.resources.length - 1;
      renderResource(resource, childPrefix, isLastResource, showFiles, config);
    }
  }
}
