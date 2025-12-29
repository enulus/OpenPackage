import { join, dirname } from 'path';

import type { CommandResult } from '../../types/index.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { assertMutableSourceOrThrow } from '../../utils/source-mutability.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolvePackageSource } from '../source-resolution/resolve-package-source.js';
import { exists, ensureDir, readTextFile, writeTextFile, walkFiles, getStats } from '../../utils/fs.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { inferPlatformFromWorkspaceFile } from '../platforms.js';
import {
  buildCandidateGroups,
  pruneWorkspaceCandidatesWithLocalPlatformVariants,
  resolveGroup,
  resolveRootGroup
} from './save-conflict-resolver.js';
import { SaveCandidate, SaveCandidateGroup } from './save-types.js';
import { createPlatformSpecificRegistryPath } from '../../utils/platform-specific-paths.js';
import { logger } from '../../utils/logger.js';

export interface SaveToSourceOptions {
  force?: boolean;
}

export async function runSaveToSourcePipeline(
  packageName: string | undefined,
  options: SaveToSourceOptions = {}
): Promise<CommandResult> {
  const cwd = process.cwd();
  if (!packageName) {
    return { success: false, error: 'Package name is required for save.' };
  }

  const { index } = await readWorkspaceIndex(cwd);
  const pkgIndex = index.packages?.[packageName];
  if (!pkgIndex || !pkgIndex.files || Object.keys(pkgIndex.files).length === 0) {
    return {
      success: false,
      error:
        `No mappings found for '${packageName}' in .openpackage/openpackage.index.yml. ` +
        `Run 'opkg apply ${packageName}' or 'opkg install ...' first.`
    };
  }

  const source = await resolvePackageSource(cwd, packageName);
  assertMutableSourceOrThrow(source.absolutePath, { packageName: source.packageName, command: 'save' });

  const groups = await buildGroupsFromIndex(cwd, source.absolutePath, pkgIndex.files);
  // Prune workspace candidates when a platform-specific file already exists locally.
  await pruneWorkspaceCandidatesWithLocalPlatformVariants(source.absolutePath, groups);

  // Resolve conflicts per group and write selections back to source.
  for (const group of groups) {
    const isRoot = group.registryPath === FILE_PATTERNS.AGENTS_MD;
    const resolution = isRoot
      ? await resolveRootGroup(group, options.force ?? false)
      : await resolveGroup(group, options.force ?? false);

    if (!resolution) continue;

    // Write universal selection.
    await writeCandidateToSource(source.absolutePath, group.registryPath, resolution.selection);

    // Write platform-specific selections when provided.
    for (const platformCandidate of resolution.platformSpecific) {
      if (!platformCandidate.platform || platformCandidate.platform === 'ai') continue;
      const platformPath = createPlatformSpecificRegistryPath(group.registryPath, platformCandidate.platform);
      if (!platformPath) continue;
      await writeCandidateToSource(source.absolutePath, platformPath, platformCandidate);
    }
  }

  return { success: true };
}

async function writeCandidateToSource(
  packageRoot: string,
  registryPath: string,
  candidate: SaveCandidate
): Promise<void> {
  const targetPath = join(packageRoot, registryPath);
  await ensureDir(dirname(targetPath));
  await writeTextFile(targetPath, candidate.content, candidate.encoding as BufferEncoding | undefined);
}

async function buildGroupsFromIndex(
  cwd: string,
  packageRoot: string,
  filesMapping: Record<string, string[]>
): Promise<SaveCandidateGroup[]> {
  const workspaceCandidates: SaveCandidate[] = [];
  const localCandidates: SaveCandidate[] = [];

  // Preload locals only for registry paths present in mapping.
  for (const registryPath of Object.keys(filesMapping)) {
    const normalizedKey = normalizePathForProcessing(registryPath);
    if (!normalizedKey) continue;
    const absLocal = join(packageRoot, normalizedKey);
    if (await exists(absLocal)) {
      const candidate = await buildCandidateFromPath('local', absLocal, normalizedKey, packageRoot, cwd);
      if (candidate) {
        localCandidates.push(candidate);
      }
    }
  }

  for (const [rawKey, targets] of Object.entries(filesMapping)) {
    const registryKey = normalizePathForProcessing(rawKey);
    if (!registryKey || !Array.isArray(targets)) continue;

    for (const workspaceRel of targets) {
      const normalizedTargetDir = normalizePathForProcessing(workspaceRel);
      if (!normalizedTargetDir) continue;
      const absTargetDir = join(cwd, normalizedTargetDir);

      if (registryKey.endsWith('/')) {
        const files = await collectFilesUnderDirectory(absTargetDir);
        for (const relFile of files) {
          const registryPath = normalizePathForProcessing(join(registryKey, relFile));
          if (!registryPath) continue;
          const absWorkspaceFile = join(absTargetDir, relFile);
          const candidate = await buildCandidateFromPath(
            'workspace',
            absWorkspaceFile,
            registryPath,
            packageRoot,
            cwd
          );
          if (candidate) workspaceCandidates.push(candidate);
        }
      } else {
        const absWorkspaceFile = absTargetDir;
        if (!(await exists(absWorkspaceFile))) continue;
        const candidate = await buildCandidateFromPath(
          'workspace',
          absWorkspaceFile,
          registryKey,
          packageRoot,
          cwd
        );
        if (candidate) workspaceCandidates.push(candidate);
      }
    }
  }

  const groups = buildCandidateGroups(localCandidates, workspaceCandidates);
  // Only keep groups that have at least one workspace candidate (we don't want to save unrelated local files)
  return groups.filter(group => group.workspace.length > 0);
}

async function buildCandidateFromPath(
  source: 'local' | 'workspace',
  absPath: string,
  registryPath: string,
  packageRoot: string,
  cwd: string
): Promise<SaveCandidate | null> {
  try {
    const content = await readTextFile(absPath);
    const contentHash = await calculateFileHash(content);
    const stats = await getStats(absPath);
    const displayPath =
      source === 'workspace'
        ? normalizePathForProcessing(absPath.slice(cwd.length + 1)) || registryPath
        : normalizePathForProcessing(absPath.slice(packageRoot.length)) || registryPath;
    const platform = source === 'workspace'
      ? inferPlatformFromWorkspaceFile(absPath, deriveSourceDir(displayPath), registryPath, cwd)
      : undefined;

    return {
      source,
      registryPath,
      fullPath: absPath,
      content,
      contentHash,
      mtime: stats.mtime.getTime(),
      displayPath,
      platform
    };
  } catch (error) {
    logger.warn(`Failed to build candidate for ${absPath}: ${error}`);
    return null;
  }
}

async function collectFilesUnderDirectory(absDir: string): Promise<string[]> {
  const collected: string[] = [];
  if (!(await exists(absDir))) return collected;

  for await (const absFile of walkFiles(absDir)) {
    collected.push(absFile.slice(absDir.length + 1).replace(/\\/g, '/'));
  }
  return collected;
}

function deriveSourceDir(relPath: string | undefined): string {
  if (!relPath) return '';
  const first = relPath.split('/')[0] || '';
  return first;
}
