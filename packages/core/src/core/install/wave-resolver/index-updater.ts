/**
 * Updates openpackage.index.yml with resolved dependency information.
 * Called after successful installation to record resolved versions,
 * source paths, and dependency relationships.
 *
 * This runs after the installation pipeline (not during resolution),
 * ensuring the index reflects actually-installed packages.
 */

import { readWorkspaceIndex, writeWorkspaceIndex } from '../../../utils/workspace-index-yml.js';
import type { WaveGraph } from './types.js';
import { logger } from '../../../utils/logger.js';
import { classifyIndexSourceType } from '../../source-mutability.js';
import { isQualifiedName, buildQualifiedName } from '../../../utils/qualified-name.js';

/**
 * Update openpackage.index.yml with dependency data from the wave graph.
 *
 * For each resolved node, updates or creates an entry recording the
 * version and dependency list. File mappings are left untouched since
 * those are managed by the install pipeline itself.
 *
 * This is a best-effort operation -- failures are logged but not thrown.
 *
 * @param targetDir - Workspace directory containing the index file
 * @param graph - The resolved wave graph
 */
export async function updateWorkspaceIndex(
  targetDir: string,
  graph: WaveGraph
): Promise<void> {
  let record;
  try {
    record = await readWorkspaceIndex(targetDir);
  } catch {
    logger.warn('Could not read workspace index; skipping index update');
    return;
  }

  const index = record.index;
  let updatedCount = 0;

  for (const node of graph.nodes.values()) {
    // Skip marketplace nodes and nodes without a name
    if (node.isMarketplace) continue;

    const packageName = node.source.packageName ?? node.metadata?.name ?? node.displayName;
    if (!packageName) continue;

    const existing = index.packages[packageName];

    // Only update if we have meaningful info to add
    const version = node.resolvedVersion ?? node.metadata?.version;
    const contentRoot = node.contentRoot ?? node.source.contentRoot ?? node.source.absolutePath;

    if (!existing && !contentRoot) continue;

    // Classify source type for index persistence
    const indexSourceType = classifyIndexSourceType(node.sourceType, contentRoot ?? '');

    // Build dependency list from children
    const dependencies: string[] = [];
    for (const childId of node.children) {
      const childNode = graph.nodes.get(childId);
      if (childNode) {
        const childName =
          childNode.source.packageName ?? childNode.metadata?.name ?? childNode.displayName;
        if (childName) {
          dependencies.push(childName);
        }
      }
    }

    if (existing) {
      // Update existing entry -- preserve file mappings
      if (version) existing.version = version;
      if (dependencies.length > 0) existing.dependencies = dependencies;
      existing.sourceType = indexSourceType;
      updatedCount++;
    } else if (contentRoot) {
      // Create new entry -- minimal; the install pipeline adds file mappings
      index.packages[packageName] = {
        path: contentRoot,
        version,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
        sourceType: indexSourceType,
        files: {}
      };
      updatedCount++;
    }
  }

  // Second pass: infer parent relationships for embedded packages.
  // Build a map of contentRoot → nodeName for O(n) lookup instead of O(n²).
  const rootToName = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    if (node.isMarketplace) continue;
    const name = node.source.packageName ?? node.metadata?.name ?? node.displayName;
    const root = node.contentRoot ?? node.source.contentRoot ?? node.source.absolutePath;
    if (name && root) {
      rootToName.set(root.replace(/\\/g, '/'), name);
    }
  }

  for (const node of graph.nodes.values()) {
    if (node.isMarketplace) continue;
    const nodeName = node.source.packageName ?? node.metadata?.name ?? node.displayName;
    if (!nodeName) continue;
    const nodeContentRoot = node.contentRoot ?? node.source.contentRoot ?? node.source.absolutePath;
    if (!nodeContentRoot) continue;

    const normalizedNodeRoot = nodeContentRoot.replace(/\\/g, '/');

    // Walk up path segments looking for a parent whose contentRoot + /packages/ contains this node
    const segments = normalizedNodeRoot.split('/');
    for (let i = segments.length - 1; i >= 2; i--) {
      if (segments[i - 1] !== 'packages') continue;
      const candidateRoot = segments.slice(0, i - 1).join('/');
      const parentName = rootToName.get(candidateRoot);
      if (!parentName || parentName === nodeName) continue;

      // This node is an embedded child of parentName
      const childName = segments[i];
      if (!childName) continue;

      const qualifiedName = buildQualifiedName(parentName, childName);
      const existing = index.packages[nodeName];

      // Rename the entry from simple name to qualified name
      if (existing && !isQualifiedName(nodeName)) {
        delete index.packages[nodeName];
        existing.parent = parentName;
        index.packages[qualifiedName] = existing;
      } else if (existing) {
        existing.parent = parentName;
      }

      // Also check the newly created entry
      const qualifiedEntry = index.packages[qualifiedName];
      if (qualifiedEntry && !qualifiedEntry.parent) {
        qualifiedEntry.parent = parentName;
      }
      break;
    }
  }

  if (updatedCount > 0) {
    try {
      await writeWorkspaceIndex(record);
      logger.info(`Updated workspace index: ${updatedCount} packages`);
    } catch (error) {
      logger.warn(`Failed to write workspace index: ${error}`);
    }
  }
}
