import path from 'path';

import { getRegistryDirectories } from '../directory.js';
import { normalizePackageName } from '../../utils/package-name.js';
import { selectInstallVersionUnified } from '../install/version-selection.js';
import { DEFAULT_VERSION_CONSTRAINT, REGISTRY_PATH_PREFIXES } from '../../constants/index.js';
import type { InstallResolutionMode } from '../install/types.js';

export interface ResolveRegistryVersionOptions {
  /**
   * Semver constraint; defaults to '*'.
   */
  constraint?: string;
  /**
   * Resolution strategy (defaults to install's "default" mode: local-first with remote fallback).
   */
  mode?: InstallResolutionMode;
  profile?: string;
  apiKey?: string;
  preferStable?: boolean;
  explicitPrereleaseIntent?: boolean;
}

import type { ResolutionSource } from '../../constants/index.js';

export interface ResolveRegistryVersionResult {
  version: string;
  declaredPath: string;
  absolutePath: string;
  resolutionSource?: ResolutionSource;
}

/**
 * Resolve a registry version and construct both declared (tilde) and absolute paths.
 */
export async function resolveRegistryVersion(
  packageName: string,
  options: ResolveRegistryVersionOptions = {}
): Promise<ResolveRegistryVersionResult> {
  const normalizedName = normalizePackageName(packageName);
  const mode: InstallResolutionMode = options.mode ?? 'default';
  const constraint = options.constraint ?? DEFAULT_VERSION_CONSTRAINT;

  const selection = await selectInstallVersionUnified({
    packageName: normalizedName,
    constraint,
    mode,
    selectionOptions: options.preferStable ? { preferStable: true } : undefined,
    explicitPrereleaseIntent: options.explicitPrereleaseIntent,
    profile: options.profile,
    apiKey: options.apiKey
  });

  if (!selection.selectedVersion) {
    throw new Error(
      `Unable to resolve a version for '${normalizedName}' with constraint '${constraint}'.`
    );
  }

  const version = selection.selectedVersion;
  const { packages: registryRoot } = getRegistryDirectories();

  const absolutePath = path.join(registryRoot, normalizedName, version, path.sep);
  const declaredPath = `${REGISTRY_PATH_PREFIXES.BASE}${normalizedName}/${version}/`;

  return {
    version,
    declaredPath,
    absolutePath,
    resolutionSource: selection.resolutionSource
  };
}
