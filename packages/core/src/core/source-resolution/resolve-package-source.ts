import path from 'path';

import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { arePackageNamesEquivalent, normalizePackageName } from '../../utils/package-name.js';
import { isRegistryPath } from '../../utils/source-mutability.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { MUTABILITY, SOURCE_TYPES } from '../../constants/index.js';
import type { ResolvedPackageSource } from './types.js';

export async function resolvePackageSource(
  workspaceRoot: string,
  packageName: string
): Promise<ResolvedPackageSource> {
  const normalizedTarget = normalizePackageName(packageName);
  const ws = await readWorkspaceIndex(workspaceRoot);
  const entryKey = Object.keys(ws.index.packages ?? {}).find(k =>
    arePackageNamesEquivalent(k, normalizedTarget)
  );
  const entry = entryKey ? ws.index.packages?.[entryKey] : undefined;
  if (!entry?.path) {
    throw new Error(
      `Package '${packageName}' is not installed in this workspace.\n` +
        `Run 'opkg install ${packageName}' to install it first.`
    );
  }

  const resolved = resolveDeclaredPath(entry.path, workspaceRoot);
  const absolutePath = path.join(resolved.absolute, path.sep);
  const mutability = isRegistryPath(absolutePath) ? MUTABILITY.IMMUTABLE : MUTABILITY.MUTABLE;
  const sourceType = isRegistryPath(absolutePath) ? SOURCE_TYPES.REGISTRY : SOURCE_TYPES.PATH;

  return {
    packageName: normalizePackageName(entryKey ?? normalizedTarget),
    absolutePath,
    declaredPath: resolved.declared,
    mutability,
    version: entry.version,
    sourceType
  };
}
