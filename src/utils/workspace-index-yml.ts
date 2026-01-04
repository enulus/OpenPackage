import { dirname, join } from 'path';
import * as yaml from 'js-yaml';
import { FILE_PATTERNS } from '../constants/index.js';
import { getLocalOpenPackageDir } from './paths.js';
import { exists, ensureDir, readTextFile, writeTextFile } from './fs.js';
import { normalizePathForProcessing } from './path-normalization.js';
import { logger } from './logger.js';
import { WorkspaceIndex, WorkspaceIndexPackage } from '../types/workspace-index.js';

const HEADER_COMMENT = '# This file is managed by OpenPackage. Do not edit manually.';

export interface WorkspaceIndexRecord {
  path: string;
  index: WorkspaceIndex;
}

export function getWorkspaceIndexPath(cwd: string): string {
  return join(getLocalOpenPackageDir(cwd), FILE_PATTERNS.OPENPACKAGE_INDEX_YML);
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
    if (values.length > 0 && typeof values[0] === 'object') {
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
    const files: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(rawFiles as Record<string, unknown>)) {
      if (typeof k !== 'string' || !Array.isArray(v)) continue;
      const normalizedKey = normalizePathForProcessing(k);
      const targets = v.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
      if (targets.length === 0) continue;
      files[normalizedKey] = targets.map(normalizePathForProcessing);
    }
    pkg.files = sortFilesMapping(files);
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

export async function readWorkspaceIndex(cwd: string): Promise<WorkspaceIndexRecord> {
  const indexPath = getWorkspaceIndexPath(cwd);

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
    return { path: indexPath, index: sanitized };
  } catch (error) {
    logger.warn(`Failed to read workspace index at ${indexPath}: ${error}`);
    return { path: indexPath, index: { packages: {} } };
  }
}

export async function writeWorkspaceIndex(record: WorkspaceIndexRecord): Promise<void> {
  const indexPath = record.path;
  const packages = record.index.packages ?? {};

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
