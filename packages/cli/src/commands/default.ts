import { createCliExecutionContext } from '../cli/context.js';
import {
  collectScopedData,
  mergeTrackedAndUntrackedResources,
} from '@opkg/core/core/list/scope-data-collector.js';
import { RESOURCE_TYPES } from '@opkg/core/core/resources/resource-registry.js';
import type { EnhancedResourceGroup, ResourceScope } from '@opkg/core/core/list/list-tree-renderer.js';
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
// Resource counting
// ---------------------------------------------------------------------------

interface ScopeCounts {
  scope: ResourceScope;
  label: string;
  path: string;
  packageCount: number;
  counts: Array<{ label: string; count: number }>;
  total: number;
}

function countResources(groups: EnhancedResourceGroup[]): Array<{ label: string; count: number }> {
  const counts: Array<{ label: string; count: number }> = [];

  for (const group of groups) {
    if (group.resources.length === 0) continue;

    // Look up the human-friendly label from RESOURCE_TYPES
    const def = RESOURCE_TYPES.find(d => d.pluralKey === group.resourceType);
    const label = def?.labelPlural ?? group.resourceType;
    counts.push({ label, count: group.resources.length });
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Printer
// ---------------------------------------------------------------------------

function printScopeCounts(scope: ScopeCounts): void {
  const header = scope.scope === 'global'
    ? `${cyan('Global')} ${dim(`(${scope.path})`)}`
    : `${cyan('Project')} ${dim(`(${scope.path})`)}`;
  console.log(header);

  if (scope.total === 0) {
    console.log(dim('  No resources installed.'));
  } else {
    const pkgLabel = scope.packageCount === 1 ? 'package' : 'packages';
    console.log(`  ${scope.packageCount} ${pkgLabel} installed`);
    const parts = scope.counts.map(c => `${bold(String(c.count))} ${c.label}`);
    console.log('  ' + parts.join(dim('  ·  ')));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runDefaultView(cwd?: string): Promise<void> {
  // Print ASCII art
  console.log(bold(ASCII_ART));
  console.log();

  // Collect resource data from both scopes (reuses list pipeline)
  let results: Array<{ scope: ResourceScope; result: any }>;
  try {
    results = await collectScopedData(
      undefined,
      {
        showProject: true,
        showGlobal: true,
        pipelineOptions: { all: true },
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
    console.log();
    console.log(dim(`opkg@${getVersion()}`));
    return;
  }

  // Build per-scope counts
  const scopeCounts: ScopeCounts[] = [];

  for (const { scope, result } of results) {
    const merged = mergeTrackedAndUntrackedResources(result.tree, result.data.untrackedFiles, scope);
    const counts = countResources(merged);
    const total = counts.reduce((sum, c) => sum + c.count, 0);

    const packageCount = result.data.packages?.length ?? 0;

    scopeCounts.push({
      scope,
      label: scope === 'global' ? 'Global' : 'Project',
      path: result.headerPath,
      packageCount,
      counts,
      total,
    });
  }

  // Print each scope
  for (let i = 0; i < scopeCounts.length; i++) {
    printScopeCounts(scopeCounts[i]);
    if (i < scopeCounts.length - 1) console.log();
  }

  console.log();
  console.log(dim(`opkg@${getVersion()}`));
}
