import { join } from 'path';
import { Command } from 'commander';

import { CommandResult } from '../types/index.js';
import { PackageYml } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { createExecutionContext } from '../core/execution-context.js';
import { listAllPackages, listPackageVersions } from '../core/directory.js';
import { getLocalPackagesDir } from '../utils/paths.js';
import { exists, listDirectories } from '../utils/fs.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { getTreeConnector, getChildPrefix } from '../core/list/list-tree-renderer.js';
import { FILE_PATTERNS } from '../constants/index.js';

// ANSI color codes
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

interface SearchOptions {
  project?: boolean;
  global?: boolean;
  registry?: boolean;
  all?: boolean;
  json?: boolean;
}

interface PackageMatch {
  name: string;
  source: 'project' | 'global' | 'registry';
  versions?: string[];       // registry packages only (sorted latest first)
  description?: string;
  keywords?: string[];
}

interface SearchResult {
  matches: PackageMatch[];
}

/**
 * Weighted matching against package metadata.
 * Returns true if query matches name, keywords, or description (checked in that order).
 */
function matchesQuery(query: string, name: string, description?: string, keywords?: string[]): boolean {
  const q = query.toLowerCase();

  // Name match (highest priority, always checked)
  if (name.toLowerCase().includes(q)) {
    return true;
  }

  // Keywords match
  if (keywords?.some(kw => kw.toLowerCase().includes(q))) {
    return true;
  }

  // Description match
  if (description?.toLowerCase().includes(q)) {
    return true;
  }

  return false;
}

/**
 * Try to load metadata from an openpackage.yml in a package directory.
 */
async function loadPackageMetadata(packageDir: string): Promise<{ description?: string; keywords?: string[] } | null> {
  const ymlPath = join(packageDir, FILE_PATTERNS.OPENPACKAGE_YML);
  if (!(await exists(ymlPath))) {
    return null;
  }

  try {
    const yml = await parsePackageYml(ymlPath);
    return { description: yml.description, keywords: yml.keywords };
  } catch {
    return null;
  }
}

/**
 * Scan a /packages directory and return PackageMatch entries.
 */
async function scanPackagesDirectory(
  packagesDir: string,
  source: 'project' | 'global',
  query?: string
): Promise<PackageMatch[]> {
  if (!(await exists(packagesDir))) {
    return [];
  }

  const dirs = await listDirectories(packagesDir);
  const names = dirs
    .filter(name => !name.startsWith('.'))
    .sort((a, b) => a.localeCompare(b));

  const matches: PackageMatch[] = [];

  for (const name of names) {
    if (!query) {
      matches.push({ name, source });
      continue;
    }

    // Try metadata-aware matching
    const metadata = await loadPackageMetadata(join(packagesDir, name));
    if (matchesQuery(query, name, metadata?.description, metadata?.keywords)) {
      matches.push({
        name,
        source,
        description: metadata?.description,
        keywords: metadata?.keywords,
      });
    }
  }

  return matches;
}

/**
 * Scan the local registry directory and return PackageMatch entries.
 */
async function scanRegistryDirectory(query?: string): Promise<PackageMatch[]> {
  const packages = await listAllPackages();
  const matches: PackageMatch[] = [];

  for (const packageName of packages) {
    const versions = await listPackageVersions(packageName);
    if (versions.length === 0) continue;

    if (!query || matchesQuery(query, packageName)) {
      matches.push({
        name: packageName,
        source: 'registry',
        versions,
      });
    }
  }

  return matches.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Display ──────────────────────────────────────────────────────

function displaySection(title: string, matches: PackageMatch[], showAll: boolean): void {
  if (matches.length === 0) return;

  console.log(dim(title));

  for (let i = 0; i < matches.length; i++) {
    const pkg = matches[i];
    const isLast = i === matches.length - 1;

    if (pkg.source === 'registry' && pkg.versions) {
      if (showAll && pkg.versions.length > 1) {
        const connector = getTreeConnector(isLast, true);
        console.log(`${connector}${pkg.name}`);
        const childPrefix = getChildPrefix('', isLast);
        for (let vi = 0; vi < pkg.versions.length; vi++) {
          const isLastVersion = vi === pkg.versions.length - 1;
          const versionConnector = getTreeConnector(isLastVersion, false);
          console.log(`${childPrefix}${versionConnector}${pkg.versions[vi]}`);
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

  console.log();
}

function displayResults(result: SearchResult, showAll: boolean): void {
  const project = result.matches.filter(m => m.source === 'project');
  const global = result.matches.filter(m => m.source === 'global');
  const registry = result.matches.filter(m => m.source === 'registry');

  let hasAny = false;

  if (project.length > 0) {
    displaySection('Project Packages (./.openpackage/packages):', project, showAll);
    hasAny = true;
  }

  if (global.length > 0) {
    displaySection('Global Packages (~/.openpackage/packages):', global, showAll);
    hasAny = true;
  }

  if (registry.length > 0) {
    displaySection('Registry (~/.openpackage/registry):', registry, showAll);
    hasAny = true;
  }

  if (!hasAny) {
    console.log(dim('No packages found.'));
  }
}

function displayJson(result: SearchResult): void {
  const output = result.matches.map(m => {
    const entry: Record<string, unknown> = {
      name: m.name,
      source: m.source,
    };
    if (m.versions) entry.versions = m.versions;
    if (m.description) entry.description = m.description;
    if (m.keywords) entry.keywords = m.keywords;
    return entry;
  });
  console.log(JSON.stringify(output, null, 2));
}

// ── Command handler ──────────────────────────────────────────────

async function searchCommand(
  query: string | undefined,
  options: SearchOptions,
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};

  // Determine which sources to search
  const explicitSources = options.project || options.global || options.registry;
  const showProject = options.project || !explicitSources;
  const showGlobal = options.global || !explicitSources;
  const showRegistry = options.registry || !explicitSources;

  const result: SearchResult = { matches: [] };

  // Scan project packages
  if (showProject) {
    const projectContext = await createExecutionContext({
      global: false,
      cwd: programOpts.cwd,
    });
    const projectPackagesDir = getLocalPackagesDir(projectContext.targetDir);
    const projectMatches = await scanPackagesDirectory(projectPackagesDir, 'project', query);
    result.matches.push(...projectMatches);
  }

  // Scan global packages
  if (showGlobal) {
    const globalContext = await createExecutionContext({
      global: true,
      cwd: programOpts.cwd,
    });
    const globalPackagesDir = getLocalPackagesDir(globalContext.targetDir);
    const globalMatches = await scanPackagesDirectory(globalPackagesDir, 'global', query);
    result.matches.push(...globalMatches);
  }

  // Scan local registry
  if (showRegistry) {
    const registryMatches = await scanRegistryDirectory(query);
    result.matches.push(...registryMatches);
  }

  // Output
  if (options.json) {
    displayJson(result);
  } else {
    displayResults(result, options.all || false);
  }

  return { success: true };
}

// ── Commander setup ──────────────────────────────────────────────

export function setupSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search available packages across local sources')
    .argument('[query]', 'filter by package name, keywords, or description')
    .option('-p, --project', 'search project packages only (./.openpackage/packages)')
    .option('-g, --global', 'search global packages only (~/.openpackage/packages)')
    .option('-r, --registry', 'search local registry only (~/.openpackage/registry)')
    .option('-a, --all', 'show all versions for registry packages (default: latest only)')
    .option('--json', 'output results as JSON')
    .action(withErrorHandling(async (query: string | undefined, options: SearchOptions, command: Command) => {
      await searchCommand(query, options, command);
    }));
}
