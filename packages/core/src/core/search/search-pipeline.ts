/**
 * Search Pipeline
 *
 * Core logic for searching packages across project, global, and registry sources.
 * No terminal-UI dependencies — display is handled by the CLI command layer.
 */

import { join } from 'path';
import { listAllPackages, listPackageVersions } from '../directory.js';
import { getLocalPackagesDir } from '../../utils/paths.js';
import { exists, listDirectories } from '../../utils/fs.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackageMatch {
  name: string;
  source: 'project' | 'global' | 'registry';
  versions?: string[];       // registry packages only (sorted latest first)
  description?: string;
  keywords?: string[];
}

export interface SearchResult {
  matches: PackageMatch[];
}

export interface SearchOptions {
  project?: boolean;
  global?: boolean;
  registry?: boolean;
  all?: boolean;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Weighted matching against package metadata.
 * Returns true if query matches name, keywords, or description (checked in that order).
 */
export function matchesQuery(query: string, name: string, description?: string, keywords?: string[]): boolean {
  const q = query.toLowerCase();

  if (name.toLowerCase().includes(q)) return true;
  if (keywords?.some(kw => kw.toLowerCase().includes(q))) return true;
  if (description?.toLowerCase().includes(q)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Try to load metadata from an openpackage.yml in a package directory.
 */
async function loadPackageMetadata(packageDir: string): Promise<{ description?: string; keywords?: string[] } | null> {
  const ymlPath = join(packageDir, FILE_PATTERNS.OPENPACKAGE_YML);
  if (!(await exists(ymlPath))) return null;

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
export async function scanPackagesDirectory(
  packagesDir: string,
  source: 'project' | 'global',
  query?: string
): Promise<PackageMatch[]> {
  if (!(await exists(packagesDir))) return [];

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
export async function scanRegistryDirectory(query?: string): Promise<PackageMatch[]> {
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

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface RunSearchOptions {
  query?: string;
  showProject: boolean;
  showGlobal: boolean;
  showRegistry: boolean;
  /** Factory to create execution contexts (injected by CLI layer) */
  createContext: (opts: { global: boolean; cwd?: string }) => Promise<ExecutionContext>;
  cwd?: string;
}

/**
 * Run the search pipeline across configured sources.
 * Returns a SearchResult with matches — display is the caller's concern.
 */
export async function runSearchPipeline(options: RunSearchOptions): Promise<SearchResult> {
  const result: SearchResult = { matches: [] };

  if (options.showProject) {
    const ctx = await options.createContext({ global: false, cwd: options.cwd });
    const projectPackagesDir = getLocalPackagesDir(ctx.targetDir);
    const projectMatches = await scanPackagesDirectory(projectPackagesDir, 'project', options.query);
    result.matches.push(...projectMatches);
  }

  if (options.showGlobal) {
    const ctx = await options.createContext({ global: true, cwd: options.cwd });
    const globalPackagesDir = getLocalPackagesDir(ctx.targetDir);
    const globalMatches = await scanPackagesDirectory(globalPackagesDir, 'global', options.query);
    result.matches.push(...globalMatches);
  }

  if (options.showRegistry) {
    const registryMatches = await scanRegistryDirectory(options.query);
    result.matches.push(...registryMatches);
  }

  return result;
}
