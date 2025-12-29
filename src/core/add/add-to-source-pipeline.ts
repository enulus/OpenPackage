import { resolve as resolvePath, join } from 'path';

import type { CommandResult } from '../../types/index.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { assertMutableSourceOrThrow } from '../../utils/source-mutability.js';
import { collectSourceEntries, type SourceEntry } from './source-collector.js';
import { copyFilesWithConflictResolution } from './add-conflict-handler.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { getPlatformRootFileNames } from '../../utils/platform-root-files.js';
import { getAllUniversalSubdirs, getAllPlatforms } from '../platforms.js';
import type { PackageContext } from '../package-context.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';

export interface AddToSourceOptions {
  apply?: boolean;
  platformSpecific?: boolean;
}

export interface AddToSourceResult {
  packageName: string;
  filesAdded: number;
}

export async function runAddToSourcePipeline(
  packageName: string | undefined,
  pathArg: string | undefined,
  options: AddToSourceOptions = {}
): Promise<CommandResult<AddToSourceResult>> {
  const cwd = process.cwd();

  if (!packageName) {
    return { success: false, error: 'Package name is required for add.' };
  }
  if (!pathArg) {
    return { success: false, error: 'Path argument is required for add.' };
  }

  const absInputPath = resolvePath(cwd, pathArg);
  if (!(await exists(absInputPath))) {
    return { success: false, error: `Path not found: ${pathArg}` };
  }

  const source = await resolvePackageSource(cwd, packageName);
  assertMutableSourceOrThrow(source.absolutePath, { packageName: source.packageName, command: 'add' });

  const rawEntries = await collectSourceEntries(absInputPath, cwd);
  const entries = applyCopyToRootRule(rawEntries, cwd);

  // Track workspace-relative paths per registry key for index updates.
  const workspacePathByRegistry = new Map<string, string>();
  for (const entry of entries) {
    const workspaceRel = normalizePathForProcessing(entry.sourcePath.slice(cwd.length + 1)) || entry.sourcePath;
    workspacePathByRegistry.set(normalizePathForProcessing(entry.registryPath) || entry.registryPath, workspaceRel);
  }

  const packageContext = await buildPackageContext(source);
  const changed = await copyFilesWithConflictResolution(packageContext, entries);

  if (changed.length > 0) {
    await updateWorkspaceIndex(cwd, source.packageName, source.declaredPath, changed, workspacePathByRegistry);
  }

  // Optional immediate apply: reuse existing apply pipeline.
  if (options.apply) {
    const { runApplyPipeline } = await import('../apply/apply-pipeline.js');
    await runApplyPipeline(source.packageName, {});
  }

  return {
    success: true,
    data: {
      packageName: source.packageName,
      filesAdded: changed.length
    }
  };
}

function applyCopyToRootRule(entries: SourceEntry[], cwd: string): SourceEntry[] {
  const universalSubdirs = getAllUniversalSubdirs(cwd);
  const rootFileNames = getPlatformRootFileNames(getAllPlatforms(cwd), cwd);

  return entries.map(entry => {
    const normalized = normalizePathForProcessing(entry.registryPath) || entry.registryPath;

    const isUniversal =
      universalSubdirs.has(normalized.split('/')[0] || '') ||
      normalized.startsWith(`${FILE_PATTERNS.AGENTS_MD}`) ||
      normalized.startsWith('root/');

    const isRootFile = rootFileNames.has(normalized);

    if (isUniversal || isRootFile) {
      return { ...entry, registryPath: normalized };
    }

    // Everything else → copy-to-root
    return { ...entry, registryPath: normalizePathForProcessing(`root/${normalized}`) || `root/${normalized}` };
  });
}

async function buildPackageContext(source: Awaited<ReturnType<typeof resolvePackageSource>>): Promise<PackageContext> {
  const packageYmlPath = join(source.absolutePath, FILE_PATTERNS.OPENPACKAGE_YML);
  const config = await parsePackageYml(packageYmlPath);

  return {
    name: source.packageName,
    version: config.version,
    config,
    packageYmlPath,
    packageRootDir: source.absolutePath,
    packageFilesDir: source.absolutePath,
    location: 'nested',
    isCwdPackage: false
  };
}

async function updateWorkspaceIndex(
  cwd: string,
  packageName: string,
  declaredPath: string,
  changed: Array<{ path: string }>,
  workspacePathByRegistry: Map<string, string>
): Promise<void> {
  const record = await readWorkspaceIndex(cwd);
  if (!record.index.packages[packageName]) {
    record.index.packages[packageName] = { path: declaredPath, files: {} };
  }
  const entry = record.index.packages[packageName];
  entry.path = entry.path || declaredPath;
  entry.files = entry.files || {};

  for (const file of changed) {
    const key = normalizePathForProcessing(file.path) || file.path;
    if (!entry.files[key]) entry.files[key] = [];
    const workspaceRel = workspacePathByRegistry.get(key);
    if (!workspaceRel) continue;
    if (!entry.files[key].includes(workspaceRel)) {
      entry.files[key].push(workspaceRel);
    }
  }

  await writeWorkspaceIndex(record);
}
