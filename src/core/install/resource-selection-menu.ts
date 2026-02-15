/**
 * Resource Selection Menu
 * 
 * Interactive menu for selecting specific resources to install
 */

import { log } from '@clack/prompts';
import { logger } from '../../utils/logger.js';
import { UserCancellationError } from '../../utils/errors.js';
import { clackGroupMultiselect } from '../../utils/clack-multiselect.js';
import { smartMultiselect } from '../../utils/smart-multiselect.js';
import { getInstallableTypes, toLabelPlural, RESOURCE_TYPE_ORDER } from '../resources/resource-registry.js';
import type { ResourceCatalog, ResourceEntry } from '../resources/resource-catalog.js';
import type { 
  ResourceDiscoveryResult, 
  DiscoveredResource,
  SelectedResource,
  ResourceType 
} from './resource-types.js';

/**
 * Display interactive resource selection menu
 * 
 * @param discovery - Resource discovery result
 * @param packageName - Package name for display
 * @param packageVersion - Package version for display
 * @returns Array of selected resources (empty if cancelled)
 */
export async function promptResourceSelection(
  discovery: ResourceDiscoveryResult,
  packageName: string,
  packageVersion?: string
): Promise<SelectedResource[]> {
  logger.debug('Prompting resource selection', {
    package: packageName,
    version: packageVersion,
    total: discovery.total
  });
  
  // No resources found
  if (discovery.total === 0) {
    log.warn('No resources found in this package');
    return [];
  }
  
  // Build grouped options by resource type
  const groupedOptions = buildGroupedOptions(discovery);
  
  if (Object.keys(groupedOptions).length === 0) {
    log.warn('No installable resources found');
    return [];
  }
  
  try {
    const selectedResources = await clackGroupMultiselect<DiscoveredResource>(
      'Select resources to install:',
      groupedOptions,
      {
        selectableGroups: true,
        groupSpacing: 0
      }
    );
    
    if (!selectedResources || selectedResources.length === 0) {
      logger.info('User cancelled resource selection or selected nothing');
      return [];
    }
    
    // Map selected DiscoveredResource objects to SelectedResource objects
    const selected: SelectedResource[] = selectedResources.map(resource => ({
      resourceType: resource.resourceType,
      resourcePath: resource.resourcePath,
      displayName: resource.displayName,
      filePath: resource.filePath,
      installKind: resource.installKind,
      version: resource.version
    }));
    
    logger.info('User selected resources', {
      count: selected.length,
      types: Array.from(new Set(selected.map(r => r.resourceType)))
    });
    
    return selected;
  } catch (error) {
    if (error instanceof UserCancellationError) {
      logger.info('User cancelled resource selection');
      return [];
    }
    throw error;
  }
}

/**
 * Build grouped options for resource selection
 */
function buildGroupedOptions(
  discovery: ResourceDiscoveryResult
): Record<string, Array<{ value: DiscoveredResource; label: string; hint: string }>> {
  const groupedOptions: Record<string, Array<{ value: DiscoveredResource; label: string; hint: string }>> = {};
  
  // Resource type display order and labels
  const typeOrder = getInstallableTypes().map(def => ({
    type: def.id as ResourceType,
    label: def.labelPlural,
  }));
  
  for (const { type, label } of typeOrder) {
    const resources = discovery.byType.get(type);
    
    if (!resources || resources.length === 0) {
      continue;
    }
    
    // Create group name with count
    const groupName = `${label} (${resources.length})`;
    const groupOptions: Array<{ value: DiscoveredResource; label: string; hint: string }> = [];
    
    // Add resources to this group
    for (const resource of resources) {
      const versionSuffix = resource.version ? ` (v${resource.version})` : '';
      const pathHint = getPathHint(resource);
      
      // Build hint: description + path
      const fullDescription = resource.description 
        ? `${resource.description} - ${pathHint}`
        : pathHint;
      const truncatedDescription = truncateToLines(fullDescription, 2);
      
      groupOptions.push({
        value: resource,
        label: `${resource.displayName}${versionSuffix}`,
        hint: truncatedDescription
      });
    }
    
    groupedOptions[groupName] = groupOptions;
  }
  
  return groupedOptions;
}

/**
 * Get path hint for display
 */
function getPathHint(resource: DiscoveredResource): string {
  const path = resource.resourcePath;
  
  if (resource.installKind === 'directory') {
    return `${path}/`;
  }
  
  return path;
}

/**
 * Truncate text to a maximum number of lines
 * Approximates line breaks based on typical terminal width (~80 chars per line)
 */
function truncateToLines(text: string, maxLines: number): string {
  const charsPerLine = 80;
  const maxChars = charsPerLine * maxLines;
  
  if (text.length <= maxChars) {
    return text;
  }
  
  // Truncate and add ellipsis
  return text.substring(0, maxChars - 3) + '...';
}

/**
 * Display summary of selected resources
 */
export function displaySelectionSummary(selected: SelectedResource[]): void {
  if (selected.length === 0) {
    return;
  }
  
  // Group by type
  const byType = new Map<ResourceType, number>();
  for (const resource of selected) {
    const count = byType.get(resource.resourceType) || 0;
    byType.set(resource.resourceType, count + 1);
  }
  
  const summary = [`Selected ${selected.length} resource${selected.length === 1 ? '' : 's'}:`];
  
  for (const [type, count] of byType.entries()) {
    const label = getTypeLabel(type);
    summary.push(`  • ${count} ${label.toLowerCase()}`);
  }
  
  log.info(summary.join('\n'));
}

/**
 * Get display label for resource type
 */
function getTypeLabel(type: ResourceType): string {
  return toLabelPlural(type);
}

export async function promptCatalogSelection(
  catalog: ResourceCatalog,
  header: { name: string; version?: string; action: string }
): Promise<ResourceEntry[]> {
  logger.debug('Prompting catalog selection', {
    action: header.action,
    total: catalog.total
  });
  
  if (catalog.total === 0) {
    log.warn('No resources found');
    return [];
  }
  
  const { choices, categoryMap, indexToEntry } = buildCatalogMenuChoices(catalog);
  
  if (choices.length === 0) {
    log.warn('No selectable resources found');
    return [];
  }
  
  try {
    const selectedIndices = await smartMultiselect(
      `Select resources to ${header.action}:`,
      choices,
      categoryMap,
      {
        hint: '- Space: select/deselect • Enter: confirm • Categories expand to all items',
        min: 1
      }
    );
    
    if (!selectedIndices || selectedIndices.length === 0) {
      logger.info('User cancelled resource selection or selected nothing');
      return [];
    }
    
    const resourceIndices = selectedIndices.filter(idx => idx >= 0);
    const selected = resourceIndices
      .filter(idx => indexToEntry.has(idx))
      .map(idx => indexToEntry.get(idx)!);
    
    logger.info('User selected resources', {
      count: selected.length,
      types: Array.from(new Set(selected.map(r => r.resourceType)))
    });
    
    return selected;
  } catch (error) {
    if (error instanceof UserCancellationError) {
      logger.info('User cancelled resource selection');
      return [];
    }
    throw error;
  }
}

function buildCatalogMenuChoices(
  catalog: ResourceCatalog
): { choices: any[]; categoryMap: Map<number, number[]>; indexToEntry: Map<number, ResourceEntry> } {
  const choices: any[] = [];
  const categoryMap = new Map<number, number[]>();
  const indexToEntry = new Map<number, ResourceEntry>();
  
  const typeOrder = RESOURCE_TYPE_ORDER;
  
  let globalIndex = 0;
  let categoryIndex = -1;
  
  for (const typeId of typeOrder) {
    const entries = catalog.byType.get(typeId);
    if (!entries || entries.length === 0) continue;
    
    const label = toLabelPlural(typeId);
    const currentCategoryIndex = categoryIndex;
    const categoryResourceIndices: number[] = [];
    
    const boldLabel = `\x1b[1m${label} (${entries.length}):\x1b[0m`;
    choices.push({
      title: boldLabel,
      value: currentCategoryIndex,
      description: 'Select/deselect all items in this category'
    });
    
    for (const entry of entries) {
      const versionSuffix = entry.version ? ` (v${entry.version})` : '';
      const pathHint = getCatalogPathHint(entry);
      
      const fullDescription = entry.description
        ? `${entry.description} - ${pathHint}`
        : pathHint;
      const truncatedDescription = fullDescription.length > 160
        ? fullDescription.substring(0, 157) + '...'
        : fullDescription;
      
      categoryResourceIndices.push(globalIndex);
      indexToEntry.set(globalIndex, entry);
      
      choices.push({
        title: `  ${entry.name}${versionSuffix}`,
        value: globalIndex++,
        description: truncatedDescription
      });
    }
    
    categoryMap.set(currentCategoryIndex, categoryResourceIndices);
    categoryIndex--;
  }
  
  return { choices, categoryMap, indexToEntry };
}

function getCatalogPathHint(entry: ResourceEntry): string {
  if (entry.origin === 'installed') {
    if (entry.files.length === 1 && entry.files[0].target) {
      return entry.files[0].target;
    }
    return `(${entry.files.length} file${entry.files.length === 1 ? '' : 's'})`;
  }
  
  if (entry.resourcePath) {
    return entry.installKind === 'directory' ? `${entry.resourcePath}/` : entry.resourcePath;
  }
  
  return '';
}

export function displayCatalogSelectionSummary(selected: ResourceEntry[], action: string): void {
  if (selected.length === 0) return;
  
  const byType = new Map<string, number>();
  for (const entry of selected) {
    byType.set(entry.resourceType, (byType.get(entry.resourceType) || 0) + 1);
  }
  
  console.log(`\n✓ Selected ${selected.length} resource${selected.length === 1 ? '' : 's'} to ${action}:`);
  
  for (const [type, count] of byType.entries()) {
    const label = toLabelPlural(type as any);
    console.log(`  • ${count} ${label.toLowerCase()}`);
  }
  
  console.log('');
}
