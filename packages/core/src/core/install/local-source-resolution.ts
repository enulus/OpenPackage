import os from 'os';
import path from 'path';

import { DIR_PATTERNS, OPENPACKAGE_DIRS, UNVERSIONED } from '../../constants/index.js';
import { listPackageVersions, getPackageVersionPath } from '../directory.js';
import { exists } from '../../utils/fs.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { getLocalPackageDir } from '../../utils/paths.js';
import { SCOPED_PACKAGE_REGEX, normalizePackageName } from '../../utils/package-name.js';
import semver from 'semver';
import type { InstallResolutionMode } from './types.js';

type MutableSourceKind = 'workspaceMutable' | 'globalMutable';

export interface MutableSourceInfo {
  kind: MutableSourceKind;
  packageRootDir: string;
  version: string;
}

export interface CandidateVersionsResult {
  localVersions: string[];
  sourceKind?: MutableSourceKind | 'registry';
  contentRoot?: string;
}

function getGlobalMutablePackageDir(packageName: string): string {
  const normalizedName = normalizePackageName(packageName);
  const scopedMatch = normalizedName.match(SCOPED_PACKAGE_REGEX);
  const baseDir = path.join(os.homedir(), DIR_PATTERNS.OPENPACKAGE, OPENPACKAGE_DIRS.PACKAGES);

  if (scopedMatch) {
    const [, scope, localName] = scopedMatch;
    return path.join(baseDir, `@${scope}`, localName);
  }

  return path.join(baseDir, normalizedName);
}

async function loadMutableSourceVersion(packageRootDir: string): Promise<string | null> {
  const manifestPath = path.join(packageRootDir, 'openpackage.yml');
  if (!(await exists(manifestPath))) {
    return null;
  }

  try {
    const manifest = await parsePackageYml(manifestPath);
    return manifest.version ?? UNVERSIONED;
  } catch {
    return null;
  }
}

export async function detectWorkspaceMutableSource(
  cwd: string,
  packageName: string
): Promise<MutableSourceInfo | null> {
  const packageRootDir = getLocalPackageDir(cwd, packageName);
  const version = await loadMutableSourceVersion(packageRootDir);
  if (!version) {
    return null;
  }

  return { kind: 'workspaceMutable', packageRootDir, version };
}

export async function detectGlobalMutableSource(
  packageName: string
): Promise<MutableSourceInfo | null> {
  const packageRootDir = getGlobalMutablePackageDir(packageName);
  const version = await loadMutableSourceVersion(packageRootDir);
  if (!version) {
    return null;
  }

  return { kind: 'globalMutable', packageRootDir, version };
}

export async function resolveCandidateVersionsForInstall(args: {
  cwd: string;
  packageName: string;
  mode: InstallResolutionMode;
}): Promise<CandidateVersionsResult> {
  const { cwd, packageName, mode } = args;

  if (mode === 'remote-primary') {
    return { localVersions: [] };
  }

  const workspaceSource = await detectWorkspaceMutableSource(cwd, packageName);
  if (workspaceSource) {
    return {
      localVersions: [workspaceSource.version],
      sourceKind: workspaceSource.kind,
      contentRoot: workspaceSource.packageRootDir
    };
  }

  const globalMutable = await detectGlobalMutableSource(packageName);
  if (globalMutable) {
    return {
      localVersions: [globalMutable.version],
      sourceKind: globalMutable.kind,
      contentRoot: globalMutable.packageRootDir
    };
  }

  const registryVersions = await listPackageVersions(packageName);
  return {
    localVersions: registryVersions,
    sourceKind: 'registry'
  };
}

export async function resolvePackageContentRoot(args: {
  cwd: string;
  packageName: string;
  version: string;
}): Promise<string> {
  const { cwd, packageName, version } = args;

  const workspaceSource = await detectWorkspaceMutableSource(cwd, packageName);
  if (workspaceSource) {
    return path.join(workspaceSource.packageRootDir, path.sep);
  }

  const globalMutable = await detectGlobalMutableSource(packageName);
  if (globalMutable) {
    return path.join(globalMutable.packageRootDir, path.sep);
  }

  const versionPath = getPackageVersionPath(packageName, version);
  return path.join(versionPath, path.sep);
}

export async function maybeWarnHigherRegistryVersion(args: {
  packageName: string;
  selectedVersion: string;
}): Promise<string | undefined> {
  if (!semver.valid(args.selectedVersion)) {
    return undefined;
  }

  const registryVersions = await listPackageVersions(args.packageName);
  if (registryVersions.length === 0) {
    return undefined;
  }

  const highest = registryVersions[0];
  if (semver.valid(highest) && semver.gt(highest, args.selectedVersion)) {
    return `Newer version available in local registry: ${args.packageName}@${args.selectedVersion} (selected) < ${args.packageName}@${highest} (registry)`;
  }

  return undefined;
}
