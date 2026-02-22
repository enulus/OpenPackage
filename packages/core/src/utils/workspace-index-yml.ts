import { dirname, join } from 'path';
import * as yaml from 'js-yaml';
import { FILE_PATTERNS } from '../constants/index.js';
import { getLocalOpenPackageDir } from './paths.js';
import { exists, ensureDir, readTextFile, writeTextFile } from './fs.js';
import { normalizePathForProcessing } from './path-normalization.js';
import { logger } from './logger.js';
import { WorkspaceIndex, WorkspaceIndexPackage } from '../types/workspace-index.js';
import type { WorkspaceIndexFileMapping } from '../types/workspace-index.js';

const HEADER_COMMENT = '# This file is managed by OpenPackage. Do not edit manually.';

export interface WorkspaceIndexRecord {
  path: string;
  index: WorkspaceIndex;
}

export function getWorkspaceIndexPath(targetDir: string): string {
  return join(getLocalOpenPackageDir(targetDir), FILE_PATTERNS.OPENPACKAGE_INDEX_YML);
}

function sortAndDedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function sortFilesMapping(files: Record<string, any[]>): Record<string, any[]> {
  const sorted: Record<string, any[]> = {};
  const keys = Object.keys(files).sort();
  for (const key of keys) {
    const values = files[key] ?? [];
    // Handle both string[] and (string | WorkspaceIndexFileMapping)[]
    const hasComplex = values.some(v => typeof v === 'object' && v !== null);
    if (hasComplex) {
      // Complex mappings - sort by target path
      sorted[key] = values.sort((a, b) => {
        const targetA = typeof a === 'string' ? a : a.target;
        const targetB = typeof b === 'string' ? b : b.target;
        return targetA.localeCompare(targetB);
      });
    } else {
      // Simple string array
      sorted[key] = sortAndDedupeStrings(values as string[]);
    }
  }
  return sorted;
}

function sanitizeWorkspaceIndexPackage(entry: any): WorkspaceIndexPackage | null {
  if (!entry || typeof entry !== 'object') return null;

  const rawPath = (entry as { path?: unknown }).path;
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return null;
  }

  const pkg: WorkspaceIndexPackage = {
    path: rawPath,
    files: {}
  };

  const rawVersion = (entry as { version?: unknown }).version;
  if (typeof rawVersion === 'string' && rawVersion.trim().length > 0) {
    pkg.version = rawVersion;
  }

  const rawDeps = (entry as { dependencies?: unknown }).dependencies;
  if (Array.isArray(rawDeps)) {
    const deps = rawDeps.filter((d): d is string => typeof d === 'string' && d.trim().length > 0);
    if (deps.length > 0) {
      pkg.dependencies = sortAndDedupeStrings(deps);
    }
  }

  const rawFiles = (entry as { files?: unknown }).files;
  if (rawFiles && typeof rawFiles === 'object') {
    const files: Record<string, (string | WorkspaceIndexFileMapping)[]> = {};
    for (const [k, v] of Object.entries(rawFiles as Record<string, unknown>)) {
      if (typeof k !== 'string' || !Array.isArray(v)) continue;
      const normalizedKey = normalizePathForProcessing(k);
      const targets: (string | WorkspaceIndexFileMapping)[] = [];
      for (const item of v as unknown[]) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (!trimmed) continue;
          targets.push(normalizePathForProcessing(trimmed));
          continue;
        }
        if (item && typeof item === 'object') {
          const rawTarget = (item as any).target;
          if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) continue;
          const mapping: WorkspaceIndexFileMapping = {
            target: normalizePathForProcessing(rawTarget)
          };
          const rawMerge = (item as any).merge;
          if (rawMerge === 'deep' || rawMerge === 'shallow' || rawMerge === 'replace' || rawMerge === 'composite') {
            mapping.merge = rawMerge;
          }
          const rawKeys = (item as any).keys;
          if (Array.isArray(rawKeys)) {
            const cleanedKeys = rawKeys.filter((x: any) => typeof x === 'string' && x.trim().length > 0);
            if (cleanedKeys.length > 0) {
              mapping.keys = cleanedKeys;
            }
          }
          targets.push(mapping);
        }
      }
      if (targets.length === 0) continue;
      files[normalizedKey] = targets;
    }
    pkg.files = sortFilesMapping(files);
  }

  // Parse marketplace metadata if present
  const rawMarketplace = (entry as { marketplace?: unknown }).marketplace;
  if (rawMarketplace && typeof rawMarketplace === 'object') {
    const url = (rawMarketplace as any).url;
    const commitSha = (rawMarketplace as any).commitSha;
    const pluginName = (rawMarketplace as any).pluginName;
    
    if (typeof url === 'string' && url.trim().length > 0 &&
        typeof commitSha === 'string' && commitSha.trim().length > 0 &&
        typeof pluginName === 'string' && pluginName.trim().length > 0) {
      pkg.marketplace = { url, commitSha, pluginName };
    }
  }

  return pkg;
}

function sanitizeWorkspaceIndexData(data: any): WorkspaceIndex | null {
  if (!data || typeof data !== 'object') return null;
  const packagesSection = (data as { packages?: unknown }).packages;
  if (!packagesSection || typeof packagesSection !== 'object') {
    return { packages: {} };
  }

  const packages: Record<string, WorkspaceIndexPackage> = {};
  for (const [pkgName, pkgEntry] of Object.entries(packagesSection as Record<string, unknown>)) {
    if (typeof pkgName !== 'string' || pkgName.trim().length === 0) continue;
    const sanitized = sanitizeWorkspaceIndexPackage(pkgEntry);
    if (sanitized) {
      packages[pkgName] = sanitized;
    }
  }

  return { packages };
}

export async function readWorkspaceIndex(targetDir: string): Promise<WorkspaceIndexRecord> {
  const indexPath = getWorkspaceIndexPath(targetDir);

  if (!(await exists(indexPath))) {
    return {
      path: indexPath,
      index: { packages: {} }
    };
  }

  try {
    const content = await readTextFile(indexPath);
    const parsed = yaml.load(content) as any;
    const sanitized = sanitizeWorkspaceIndexData(parsed);
    if (!sanitized) {
      logger.warn(`Invalid workspace index detected at ${indexPath}, returning empty.`);
      return { path: indexPath, index: { packages: {} } };
    }
    
    // Migrate in-memory on read so consumers see a unified key format.
    // (Disk is only updated when writeWorkspaceIndex is called.)
    return { path: indexPath, index: migrateGitHubPackageNames(sanitized) };
  } catch (error) {
    logger.warn(`Failed to read workspace index at ${indexPath}: ${error}`);
    return { path: indexPath, index: { packages: {} } };
  }
}

/**
 * Migrate old GitHub package names to new format.
 * Converts:
 * - @username/repo → gh@username/repo
 * - @username/repo/path → gh@username/repo/path
 * 
 * Also normalizes package names to use full path from git cache location.
 * For example: gh@user/repo/basename → gh@user/repo/full/path
 */
function migrateGitHubPackageNames(index: WorkspaceIndex): WorkspaceIndex {
  const migratedPackages: Record<string, WorkspaceIndexPackage> = {};
  
  for (const [pkgName, pkgData] of Object.entries(index.packages)) {
    const normalizedPath = pkgData.path.replace(/\\/g, '/');
    
    // Detect if this is a git source by checking:
    // 1. No version field (git sources don't have semver versions)
    // 2. Path contains git cache location marker
    const isGitSource = !pkgData.version;
    const isGitCache = normalizedPath.includes('/.openpackage/cache/git/') || 
                       normalizedPath.includes('.openpackage/cache/git/');
    
    if (!isGitSource && !isGitCache) {
      // Not a git source, keep as-is
      migratedPackages[pkgName] = pkgData;
      continue;
    }
    
    // Extract the actual path from git cache location
    // Format: .openpackage/cache/git/{url-hash}/{commit-hash}/{optional-subpath}
    const gitCacheMatch = normalizedPath.match(/\.openpackage\/cache\/git\/[^\/]+\/[^\/]+(?:\/(.+))?$/);
    const actualSubpath = gitCacheMatch?.[1] || undefined;
    
    // Parse package name to extract username/repo
    let username: string | undefined;
    let repo: string | undefined;
    let nameHasGhPrefix = false;
    let nameSubpathFromName: string | undefined;
    
    // Check for gh@ prefix first
    if (pkgName.startsWith('gh@')) {
      nameHasGhPrefix = true;
      const ghMatch = pkgName.match(/^gh@([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
      if (ghMatch) {
        username = ghMatch[1];
        repo = ghMatch[2];
        nameSubpathFromName = ghMatch[3] || undefined;
      }
    }
    // Check for @ prefix (old format)
    else if (pkgName.startsWith('@')) {
      const atMatch = pkgName.match(/^@([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
      if (atMatch) {
        username = atMatch[1];
        repo = atMatch[2];
        nameSubpathFromName = atMatch[3] || undefined;
      }
    }
    // Check for no prefix (missing @)
    else {
      const noAtMatch = pkgName.match(/^([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
      if (noAtMatch) {
        username = noAtMatch[1];
        repo = noAtMatch[2];
        nameSubpathFromName = noAtMatch[3] || undefined;
      }
    }
    
    // If we couldn't extract username/repo, keep original
    if (!username || !repo) {
      migratedPackages[pkgName] = pkgData;
      continue;
    }

    // Decide whether to migrate the subpath portion.
    // IMPORTANT: Never "collapse" a more-specific resource name to a less-specific path.
    // Example: keep gh@u/r/plugins/x/skills/y even if cache path is plugins/x.
    const nameSubpath = nameSubpathFromName;

    let targetSubpath: string | undefined = actualSubpath;
    if (actualSubpath && nameSubpath) {
      const actualNorm = actualSubpath.replace(/\\/g, '/');
      const nameNorm = nameSubpath.replace(/\\/g, '/');

      if (nameNorm === actualNorm) {
        // exact match, ok
        targetSubpath = actualSubpath;
      } else if (actualNorm.endsWith(`/${nameNorm}`)) {
        // Old basename-style name: gh@u/r/basename → gh@u/r/full/path
        targetSubpath = actualSubpath;
      } else if (nameNorm.startsWith(`${actualNorm}/`)) {
        // Resource-scoped install: keep the more-specific name
        targetSubpath = nameSubpath;
      } else {
        // Unknown relationship: prefer not to rewrite (avoid data loss)
        targetSubpath = nameSubpath;
      }
    } else if (!actualSubpath && nameSubpath) {
      // No cache subpath detected, keep explicit name subpath
      targetSubpath = nameSubpath;
    } else if (actualSubpath && !nameSubpath) {
      // Name has no subpath but cache does → upgrade to include subpath
      targetSubpath = actualSubpath;
    }

    // Build the correct package name (at minimum, normalize to gh@ prefix)
    const correctName = targetSubpath
      ? `gh@${username}/${repo}/${targetSubpath}`
      : `gh@${username}/${repo}`;
    
    // Use the correct name (which might be the same as original if already correct)
    migratedPackages[correctName] = pkgData;
  }
  
  return { packages: migratedPackages };
}

export async function writeWorkspaceIndex(record: WorkspaceIndexRecord): Promise<void> {
  const indexPath = record.path;
  
  // Migrate package names before writing
  const migrated = migrateGitHubPackageNames(record.index);
  const packages = migrated.packages ?? {};

  const sortedPackages: Record<string, WorkspaceIndexPackage> = {};
  for (const pkgName of Object.keys(packages).sort()) {
    const pkg = packages[pkgName];
    const sortedPkg: WorkspaceIndexPackage = {
      path: pkg.path,
      files: sortFilesMapping(pkg.files ?? {})
    };
    if (pkg.version) {
      sortedPkg.version = pkg.version;
    }
    if (pkg.dependencies && pkg.dependencies.length > 0) {
      sortedPkg.dependencies = sortAndDedupeStrings(pkg.dependencies);
    }
    if (pkg.marketplace) {
      sortedPkg.marketplace = pkg.marketplace;
    }
    sortedPackages[pkgName] = sortedPkg;
  }

  await ensureDir(dirname(indexPath));

  const body = yaml.dump(
    {
      packages: sortedPackages
    },
    {
      lineWidth: 120,
      sortKeys: true
    }
  );

  const serialized = `${HEADER_COMMENT}\n\n${body}`;
  await writeTextFile(indexPath, serialized);
}
