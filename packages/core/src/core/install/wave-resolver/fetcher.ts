/**
 * Per-source-type metadata fetchers for the wave resolver.
 * Routes dependency declarations to the appropriate loader (registry, git, path)
 * and returns standardized FetchResults including child dependencies.
 */

import type { PackageYml } from '../../../types/index.js';
import type {
  PackageFetcher,
  FetchResult,
  FetcherOptions,
  DependencyDeclaration,
  ResolvedSource
} from './types.js';
import { selectInstallVersionUnified } from '../version-selection.js';
import { resolvePackageContentRoot } from '../local-source-resolution.js';
import { ensureContentRoot } from './content-root-cache.js';
import { normalizeGitUrl } from '../../../utils/git-url-parser.js';
import { resolveDeclaredPath } from '../../../utils/path-resolution.js';
import { readManifestAtPath, extractDependencies } from './manifest-reader.js';
import { logger } from '../../../utils/logger.js';

/**
 * Compute a canonical dependency ID for wave-resolver deduplication.
 *
 * Registry deps use name-only keys (`registry:<name>`) so that the same
 * package referenced from multiple parents with different version constraints
 * merges into a single node for version solving.
 */
export function computeWaveId(
  declaration: DependencyDeclaration,
  declaredInDir: string
): { id: string; displayName: string; sourceType: 'registry' | 'path' | 'git' } {
  const depName = String(declaration.name ?? '').trim();

  if (declaration.url) {
    const [gitUrlRaw, embeddedRef] = declaration.url.includes('#')
      ? declaration.url.split('#', 2)
      : [declaration.url, undefined];
    const ref = embeddedRef || declaration.ref || 'default';
    const normalizedUrl = normalizeGitUrl(gitUrlRaw);
    let resourcePath = declaration.path ?? '';
    if (depName.startsWith('gh@')) {
      const tail = depName.slice(3);
      const parts = tail.split('/').filter(Boolean);
      if (parts.length > 2 && !resourcePath) {
        resourcePath = parts.slice(2).join('/');
      }
    }
    const id = `git:${normalizedUrl}#${ref}:${resourcePath}`;
    const displayName = depName || (resourcePath ? `git@${normalizedUrl}/${resourcePath}` : `git@${normalizedUrl}`);
    return { id, displayName, sourceType: 'git' };
  }

  if (declaration.path) {
    const { absolute } = resolveDeclaredPath(declaration.path, declaredInDir);
    const id = `path:${absolute}`;
    const displayName = depName || declaration.path;
    return { id, displayName, sourceType: 'path' };
  }

  // Registry: name-only key for constraint merging
  const id = `registry:${depName}`;
  return { id, displayName: depName, sourceType: 'registry' };
}

/**
 * Build a ResolvedSource from a dependency declaration.
 * Mirrors the logic in graph-builder's resolveSourceFromDeclaration.
 */
export function resolveSourceFromDeclaration(
  declaration: DependencyDeclaration,
  pathResolutionDir: string
): ResolvedSource {
  if (declaration.url) {
    const [gitUrl, embeddedRef] = declaration.url.includes('#')
      ? declaration.url.split('#', 2)
      : [declaration.url, undefined];
    const ref = embeddedRef || declaration.ref;
    const depName = String(declaration.name ?? '');
    let resourcePath = declaration.path ?? '';
    if (depName.startsWith('gh@')) {
      const tail = depName.slice(3);
      const parts = tail.split('/').filter(Boolean);
      if (parts.length > 2 && !resourcePath) {
        resourcePath = parts.slice(2).join('/');
      }
    }
    return {
      type: 'git',
      gitUrl,
      gitRef: ref,
      resourcePath: resourcePath || undefined,
      contentRoot: undefined
    };
  }

  if (declaration.path) {
    const { absolute } = resolveDeclaredPath(declaration.path, pathResolutionDir);
    return { type: 'path', absolutePath: absolute, contentRoot: absolute };
  }

  return {
    type: 'registry',
    packageName: declaration.name,
    resolvedVersion: declaration.version,
    contentRoot: undefined
  };
}

// ---------------------------------------------------------------------------
// Fetcher implementations
// ---------------------------------------------------------------------------

/**
 * Fetches registry package metadata using local-first-with-remote-fallback
 * version resolution.
 */
export class RegistryFetcher implements PackageFetcher {
  async fetch(
    declaration: DependencyDeclaration,
    declaredInDir: string,
    options: FetcherOptions
  ): Promise<FetchResult> {
    const { id, displayName, sourceType } = computeWaveId(declaration, declaredInDir);
    const source = resolveSourceFromDeclaration(declaration, declaredInDir);
    const packageName = declaration.name;
    const constraint = declaration.version ?? '*';

    // Use unified version selection (local-first with remote fallback)
    const selectionResult = await selectInstallVersionUnified({
      packageName,
      constraint,
      mode: options.resolutionMode ?? 'default',
      explicitPrereleaseIntent: false,
      profile: options.profile,
      apiKey: options.apiKey
    });

    const version = selectionResult.selectedVersion;
    if (!version) {
      // No version found - return minimal result without children
      return {
        id, displayName, name: packageName, sourceType, source,
        childDependencies: []
      };
    }

    source.resolvedVersion = version;

    // Resolve content root for reading child manifest
    let contentRoot: string | undefined;
    try {
      contentRoot = await resolvePackageContentRoot({
        cwd: options.workspaceRoot,
        packageName,
        version
      });
      source.contentRoot = contentRoot;
    } catch {
      // Content root not available locally -- pipeline will load it later
    }

    // Read child manifest to discover transitive dependencies
    let childDeps: DependencyDeclaration[] = [];
    let metadata: PackageYml | undefined;
    if (contentRoot) {
      const manifest = await readManifestAtPath(contentRoot);
      if (manifest) {
        metadata = manifest;
        childDeps = extractDependencies(
          manifest,
          contentRoot + '/openpackage.yml',
          options.depth + 1,
          false // dev deps only at root
        );
      }
    }

    return {
      id, displayName, name: packageName, version, contentRoot,
      sourceType, source, metadata, childDependencies: childDeps
    };
  }
}

/**
 * Fetches git-sourced packages using the shared content root cache.
 * Handles marketplace detection (returns isMarketplace with no children).
 */
export class GitFetcher implements PackageFetcher {
  async fetch(
    declaration: DependencyDeclaration,
    declaredInDir: string,
    options: FetcherOptions
  ): Promise<FetchResult> {
    const { id, displayName, sourceType } = computeWaveId(declaration, declaredInDir);
    const source = resolveSourceFromDeclaration(declaration, declaredInDir);

    // Use content root cache (handles cloning + caching)
    const result = await ensureContentRoot(source, { skipCache: options.skipCache });

    if (result.isMarketplace) {
      return {
        id, displayName, name: declaration.name, sourceType, source,
        isMarketplace: true, childDependencies: [],
        repoRoot: result.repoPath
      };
    }

    const contentRoot = result.contentRoot;
    source.contentRoot = contentRoot;

    let childDeps: DependencyDeclaration[] = [];
    let metadata: PackageYml | undefined;

    if (contentRoot) {
      const manifest = await readManifestAtPath(contentRoot);
      if (manifest) {
        metadata = manifest;
        childDeps = extractDependencies(
          manifest,
          contentRoot + '/openpackage.yml',
          options.depth + 1,
          false
        );
      }
    }

    return {
      id, displayName, name: declaration.name,
      version: metadata?.version,
      contentRoot, repoRoot: result.repoPath,
      sourceType, source, metadata,
      childDependencies: childDeps
    };
  }
}

/**
 * Fetches path-sourced packages by resolving the absolute path
 * and reading the manifest directly from the filesystem.
 */
export class PathFetcher implements PackageFetcher {
  async fetch(
    declaration: DependencyDeclaration,
    declaredInDir: string,
    options: FetcherOptions
  ): Promise<FetchResult> {
    const { id, displayName, sourceType } = computeWaveId(declaration, declaredInDir);
    const source = resolveSourceFromDeclaration(declaration, declaredInDir);
    const contentRoot = source.absolutePath ?? source.contentRoot;

    let childDeps: DependencyDeclaration[] = [];
    let metadata: PackageYml | undefined;

    if (contentRoot) {
      const manifest = await readManifestAtPath(contentRoot);
      if (manifest) {
        metadata = manifest;
        childDeps = extractDependencies(
          manifest,
          contentRoot + '/openpackage.yml',
          options.depth + 1,
          false
        );
      }
    }

    return {
      id, displayName, name: declaration.name,
      version: metadata?.version,
      contentRoot, sourceType, source, metadata,
      childDependencies: childDeps
    };
  }
}

/**
 * Create the appropriate fetcher for a dependency declaration.
 */
export function createFetcher(declaration: DependencyDeclaration): PackageFetcher {
  if (declaration.url) return new GitFetcher();
  if (declaration.path) return new PathFetcher();
  return new RegistryFetcher();
}
