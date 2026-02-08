/**
 * Resource Selection Menu
 * 
 * Interactive menu for selecting specific resources to install
 */

import { logger } from '../../utils/logger.js';
import { UserCancellationError } from '../../utils/errors.js';
import { smartMultiselect } from '../../utils/smart-multiselect.js';
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
    packageName,
    total: discovery.total
  });
  
  // Display header
  const versionSuffix = packageVersion ? ` (v${packageVersion})` : '';
  console.log(`✓ Package: ${packageName}${versionSuffix}`);
  console.log(`  ${discovery.total} resource${discovery.total === 1 ? '' : 's'} available\n`);
  
  // No resources found
  if (discovery.total === 0) {
    console.log('⚠️  No resources found in this package');
    return [];
  }
  
  // Build choices grouped by resource type
  const { choices, categoryMap } = buildMenuChoices(discovery);
  
  if (choices.length === 0) {
    console.log('⚠️  No installable resources found');
    return [];
  }
  
  try {
    const selectedIndices = await smartMultiselect(
      'Select resources to install:',
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
    
    // Filter out category indices (negative values) before mapping
    const resourceIndices = selectedIndices.filter(idx => idx >= 0);
    
    // Map selected indices to resources
    const selected = mapIndicesToResources(resourceIndices, discovery);
    
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
 * Build menu choices grouped by resource type
 */
function buildMenuChoices(
  discovery: ResourceDiscoveryResult
): { choices: any[]; categoryMap: Map<number, number[]> } {
  const choices: any[] = [];
  const categoryMap = new Map<number, number[]>(); // Maps category index to resource indices
  
  // Resource type display order and labels
  const typeOrder: Array<{ type: ResourceType; label: string }> = [
    { type: 'agent', label: 'Agents' },
    { type: 'skill', label: 'Skills' },
    { type: 'command', label: 'Commands' },
    { type: 'rule', label: 'Rules' },
    { type: 'hook', label: 'Hooks' },
    { type: 'mcp', label: 'MCP Servers' }
  ];
  
  let globalIndex = 0;
  let categoryIndex = -1;
  
  for (const { type, label } of typeOrder) {
    const resources = discovery.byType.get(type);
    
    if (!resources || resources.length === 0) {
      continue;
    }
    
    // Track resource indices for this category
    const categoryResourceIndices: number[] = [];
    const currentCategoryIndex = categoryIndex;
    
    // Add section header with bold styling (no newline prefix, selectable)
    const boldLabel = `\x1b[1m${label} (${resources.length}):\x1b[0m`;
    choices.push({
      title: boldLabel,
      value: currentCategoryIndex,
      description: 'Select/deselect all items in this category'
    });
    
    // Add resources in this category
    for (const resource of resources) {
      const versionSuffix = resource.version ? ` (v${resource.version})` : '';
      const pathHint = getPathHint(resource);
      
      // Truncate description to max 2 lines (approx 160 chars for typical terminal width)
      const fullDescription = resource.description 
        ? `${resource.description} - ${pathHint}`
        : pathHint;
      const truncatedDescription = truncateToLines(fullDescription, 2);
      
      categoryResourceIndices.push(globalIndex);
      
      choices.push({
        title: `  ${resource.displayName}${versionSuffix}`,
        value: globalIndex++,
        description: truncatedDescription
      });
    }
    
    // Store mapping of category to its resource indices
    categoryMap.set(currentCategoryIndex, categoryResourceIndices);
    
    // Decrement for next category
    categoryIndex--;
  }
  
  return { choices, categoryMap };
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
 * Map selected indices to actual resources
 */
function mapIndicesToResources(
  selectedIndices: number[],
  discovery: ResourceDiscoveryResult
): SelectedResource[] {
  const selected: SelectedResource[] = [];
  
  for (const index of selectedIndices) {
    if (index < 0 || index >= discovery.all.length) {
      logger.warn('Invalid selection index', { index });
      continue;
    }
    
    const resource = discovery.all[index];
    
    selected.push({
      resourceType: resource.resourceType,
      resourcePath: resource.resourcePath,
      displayName: resource.displayName,
      filePath: resource.filePath,
      installKind: resource.installKind,
      version: resource.version
    });
  }
  
  return selected;
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
  
  console.log(`\n✓ Selected ${selected.length} resource${selected.length === 1 ? '' : 's'}:`);
  
  for (const [type, count] of byType.entries()) {
    const label = getTypeLabel(type);
    console.log(`  • ${count} ${label.toLowerCase()}`);
  }
  
  console.log('');
}

/**
 * Get display label for resource type
 */
function getTypeLabel(type: ResourceType): string {
  const labels: Record<ResourceType, string> = {
    agent: 'Agents',
    skill: 'Skills',
    command: 'Commands',
    rule: 'Rules',
    hook: 'Hooks',
    mcp: 'MCP Servers'
  };
  
  return labels[type] || type;
}
