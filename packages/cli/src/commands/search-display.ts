/**
 * Search Display Helpers
 *
 * Terminal-specific display formatting for search results.
 * Separated from search.ts to keep the command handler thin.
 */

import type { SearchResult, PackageMatch } from '@opkg/core/core/search/search-pipeline.js';
import { getTreeConnector, getChildPrefix } from '@opkg/core/core/list/list-tree-renderer.js';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function cyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Display functions
// ---------------------------------------------------------------------------

function displaySection(title: string, subtitle: string, matches: PackageMatch[], showAll: boolean): void {
  if (matches.length === 0) return;

  console.log(`${cyan(title)} ${dim(subtitle)}`);

  for (let i = 0; i < matches.length; i++) {
    const pkg = matches[i];
    const isLast = i === matches.length - 1;

    if (pkg.source === 'registry' && pkg.versions) {
      if (showAll && pkg.versions.length > 1) {
        const connector = getTreeConnector(isLast, true);
        console.log(`${connector}${pkg.name}`);
        const childPfx = getChildPrefix('', isLast);
        for (let vi = 0; vi < pkg.versions.length; vi++) {
          const isLastVersion = vi === pkg.versions.length - 1;
          const versionConnector = getTreeConnector(isLastVersion, false);
          console.log(`${childPfx}${versionConnector}${pkg.versions[vi]}`);
        }
      } else {
        const connector = getTreeConnector(isLast, false);
        console.log(`${connector}${pkg.name}@${pkg.versions[0]}`);
      }
    } else {
      const connector = getTreeConnector(isLast, false);
      console.log(`${connector}${pkg.name}`);
    }
  }
}

export function displayResults(result: SearchResult, showAll: boolean): void {
  const project = result.matches.filter(m => m.source === 'project');
  const global = result.matches.filter(m => m.source === 'global');
  const registry = result.matches.filter(m => m.source === 'registry');

  let hasAny = false;

  if (project.length > 0) {
    displaySection('[Project Packages]', '(./.openpackage/packages)', project, showAll);
    hasAny = true;
  }
  if (global.length > 0) {
    displaySection('[Global Packages]', '(~/.openpackage/packages)', global, showAll);
    hasAny = true;
  }
  if (registry.length > 0) {
    displaySection('[Local Registry]', '(~/.openpackage/registry)', registry, showAll);
    hasAny = true;
  }
  if (!hasAny) {
    console.log(dim('No packages found.'));
  }
}

export function displayJson(result: SearchResult): void {
  const output = result.matches.map(m => {
    const entry: Record<string, unknown> = { name: m.name, source: m.source };
    if (m.versions) entry.versions = m.versions;
    if (m.description) entry.description = m.description;
    if (m.keywords) entry.keywords = m.keywords;
    return entry;
  });
  console.log(JSON.stringify(output, null, 2));
}
