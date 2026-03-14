import { createCliExecutionContext } from '../cli/context.js';
import {
  collectScopedData,
  collectWorkspaceRootNames,
  mergeTrackedAndUntrackedResources,
} from '@opkg/core/core/list/scope-data-collector.js';
import { RESOURCE_TYPE_ORDER, normalizeType, toLabelPlural } from '@opkg/core/core/resources/resource-registry.js';
import type { EnhancedResourceGroup, ResourceScope } from '@opkg/core/core/list/list-tree-renderer.js';
import type { ListPackageReport } from '@opkg/core/core/list/list-pipeline.js';
import { getVersion } from '@opkg/core/utils/package.js';
import { logger } from '@opkg/core/utils/logger.js';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

function cyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// ASCII art
// ---------------------------------------------------------------------------

const ASCII_ART = `█▀█ █▀█ █▀▀ █▄ █ █▀█ █▀█ █▀▀ █ █ █▀█ █▀▀▀ █▀▀
█ █ █▀▀ █▀  █ ▀█ █▀▀ █▀█ █   █▀▄ █▀█ █ ▀█ █▀
▀▀▀ ▀   ▀▀▀ ▀  ▀ ▀   ▀ ▀ ▀▀▀ ▀ ▀ ▀ ▀ ▀▀▀▀ ▀▀▀`;

// ---------------------------------------------------------------------------
// Resource & sync counting
// ---------------------------------------------------------------------------

interface SyncCounts {
  modified: number;
  outdated: number;
}

interface ScopeSummary {
  scope: ResourceScope;
  label: string;
  path: string;
  resourceCounts: Array<{ label: string; count: number }>;
  totalResources: number;
  sync: SyncCounts;
}

/** Synthetic resource type used for package-container groups (mirrors scope-data-collector). */
const PACKAGES_GROUP_TYPE = 'packages';

function addResourceCount(
  map: Map<string, { label: string; count: number }>,
  resourceType: string,
  count: number,
): void {
  const id = normalizeType(resourceType);
  const existing = map.get(id);
  if (existing) {
    existing.count += count;
  } else {
    map.set(id, { label: toLabelPlural(id), count });
  }
}

function countResources(groups: EnhancedResourceGroup[]): Array<{ label: string; count: number }> {
  const merged = new Map<string, { label: string; count: number }>();
  let packageCount = 0;

  for (const group of groups) {
    if (group.resources.length === 0) continue;

    if (group.resourceType === PACKAGES_GROUP_TYPE) {
      // Count packages themselves, then flatten children into their type buckets
      packageCount += group.resources.length;
      for (const pkg of group.resources) {
        if (!pkg.children) continue;
        for (const child of pkg.children) {
          addResourceCount(merged, child.resourceType, 1);
        }
      }
    } else {
      addResourceCount(merged, group.resourceType, group.resources.length);
    }
  }

  // Sort by canonical RESOURCE_TYPE_ORDER so display is consistent
  // regardless of whether a type first appeared in a regular group or package children
  const sorted = RESOURCE_TYPE_ORDER
    .filter(id => merged.has(id))
    .map(id => merged.get(id)!);

  // Prepend package count (packages are containers, shown before individual types)
  if (packageCount > 0) {
    sorted.unshift({ label: 'Packages', count: packageCount });
  }

  return sorted;
}

function countSyncStatus(packages: ListPackageReport[]): SyncCounts {
  let modified = 0;
  let outdated = 0;

  for (const pkg of packages) {
    // Skip registry packages — they are immutable, not syncable
    if (pkg.isRegistryPackage) continue;
    modified += pkg.modifiedCount ?? 0;
    outdated += pkg.outdatedCount ?? 0;
    outdated += pkg.sourceDeletedCount ?? 0;
    // Treat diverged as both modified and outdated (needs attention in both directions)
    const diverged = pkg.divergedCount ?? 0;
    modified += diverged;
    outdated += diverged;
  }

  return { modified, outdated };
}

// ---------------------------------------------------------------------------
// Printer
// ---------------------------------------------------------------------------

function printScopeSummary(summary: ScopeSummary): void {
  const header = summary.scope === 'global'
    ? `${cyan('Global')} ${dim(`(${summary.path})`)}`
    : `${cyan('Project')} ${dim(`(${summary.path})`)}`;
  console.log(header);

  if (summary.totalResources === 0) {
    console.log(dim('  No resources installed.'));
    return;
  }

  // Compact line: "2 Packages · 1 Skill · 1 MCP Server"
  const parts: string[] = [];
  for (const c of summary.resourceCounts) {
    const label = c.count === 1 && c.label.endsWith('s') ? c.label.slice(0, -1) : c.label;
    parts.push(`${bold(String(c.count))} ${label}`);
  }
  console.log('  ' + parts.join(dim(' · ')));

  // Sync status line (only when there are changes)
  const { modified, outdated } = summary.sync;
  if (modified > 0 || outdated > 0) {
    const segments: string[] = [];
    if (modified > 0) segments.push(`↑ ${modified} modified`);
    if (outdated > 0) segments.push(`↓ ${outdated} outdated`);
    console.log(`  ${segments.join('  ')}  ${dim('run opkg sync')}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runDefaultView(cwd?: string): Promise<void> {
  // Print ASCII art + version
  console.log();
  console.log(bold(ASCII_ART));
  console.log(dim(`opkg@${getVersion()}`));
  console.log();

  // Collect resource data from both scopes (reuses list pipeline)
  // status: true enables cheap hash-based modification detection
  let results: Array<{ scope: ResourceScope; result: any }>;
  try {
    results = await collectScopedData(
      undefined,
      {
        showProject: true,
        showGlobal: true,
        pipelineOptions: { all: true, status: true },
        cwd,
      },
      (opts) => createCliExecutionContext({ global: opts.global, cwd: opts.cwd })
    );
  } catch (error) {
    logger.debug(`Failed to collect resource data: ${error}`);
    results = [];
  }

  if (results.length === 0) {
    console.log(dim('No resources installed. Run `opkg install <package>` to get started.'));
    printHints();
    return;
  }

  // Build per-scope summaries
  const summaries: ScopeSummary[] = [];

  const workspaceRootNames = collectWorkspaceRootNames(results);

  for (const { scope, result } of results) {
    const merged = mergeTrackedAndUntrackedResources(result.tree, result.data.untrackedFiles, scope, workspaceRootNames, true);
    const resourceCounts = countResources(merged);
    const totalResources = resourceCounts.reduce((sum, c) => sum + c.count, 0);
    const sync = countSyncStatus(result.data.packages ?? []);

    summaries.push({
      scope,
      label: scope === 'global' ? 'Global' : 'Project',
      path: result.headerPath,
      resourceCounts,
      totalResources,
      sync,
    });
  }

  // Print each scope
  for (let i = 0; i < summaries.length; i++) {
    printScopeSummary(summaries[i]);
    if (i < summaries.length - 1) console.log();
  }

  printHints();
}

function printHints(): void {
  console.log();
  console.log(dim('Manage   install, uninstall, list'));
  console.log(dim('Author   new, add, remove, sync'));
  console.log(dim('Help     opkg <command> -h'));
  console.log();
}
