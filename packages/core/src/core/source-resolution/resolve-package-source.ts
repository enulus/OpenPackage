import path from 'path';

import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { normalizePackageName } from '../../utils/package-name.js';
import { isRegistryPath, classifyMutability } from '../source-mutability.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { MUTABILITY, SOURCE_TYPES, type SourceType } from '../../constants/index.js';
import type { ResolvedPackageSource } from './types.js';
import { findPackageInIndex } from '../../utils/workspace-index-helpers.js';

export async function resolvePackageSource(
  workspaceRoot: string,
  packageName: string
): Promise<ResolvedPackageSource> {
  const normalizedTarget = normalizePackageName(packageName);
  const ws = await readWorkspaceIndex(workspaceRoot);
  const match = findPackageInIndex(normalizedTarget, ws.index.packages ?? {});
  const entryKey = match?.key;
  const entry = match?.entry;
  if (!entry?.path) {
    throw new Error(
      `Package '${packageName}' is not installed in this workspace.\n` +
        `Run 'opkg install ${packageName}' to install it first.`
    );
  }

  const resolved = resolveDeclaredPath(entry.path, workspaceRoot);
  const absolutePath = path.join(resolved.absolute, path.sep);

  // Prefer stored sourceType; fall back to path-based inference for legacy entries
  let sourceType: SourceType;
  if (entry.sourceType) {
    // Map index source type to resolution source type
    sourceType = entry.sourceType === 'registry' ? SOURCE_TYPES.REGISTRY
      : entry.sourceType === 'git' ? SOURCE_TYPES.GIT
      : SOURCE_TYPES.PATH;
  } else {
    sourceType = isRegistryPath(absolutePath) ? SOURCE_TYPES.REGISTRY : SOURCE_TYPES.PATH;
  }

  const mutability = classifyMutability(entry.sourceType, absolutePath) === 'immutable'
    ? MUTABILITY.IMMUTABLE : MUTABILITY.MUTABLE;

  return {
    packageName: normalizePackageName(entryKey ?? normalizedTarget),
    absolutePath,
    declaredPath: resolved.declared,
    mutability,
    version: entry.version,
    sourceType
  };
}
