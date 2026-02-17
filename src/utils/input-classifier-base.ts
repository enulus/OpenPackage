import { resolve, basename } from 'path';

import { parseResourceArg, type ResourceSpec } from './resource-arg-parser.js';
import { classifyPackageInput } from './package-input.js';
import { detectGitSource } from './git-url-detection.js';
import { exists } from './fs.js';
import { isValidPackageDirectory } from '../core/package-context.js';
import { detectPluginType } from '../core/install/plugin-detector.js';

/**
 * Base input classification result - represents parsed source information
 * WITHOUT command-specific context or features.
 */
export type BaseInputClassification =
  | GitInputSpec
  | RegistryInputSpec
  | LocalPathInputSpec
  | BulkInputSpec;

export interface GitInputSpec {
  type: 'git';
  gitUrl: string;
  gitRef?: string;
  gitPath?: string;
  /** Derived package name (from repo) */
  derivedName?: string;
}

export interface RegistryInputSpec {
  type: 'registry';
  packageName: string;
  version?: string;
  registryPath?: string;
}

export interface LocalPathInputSpec {
  type: 'local-path';
  absolutePath: string;
  isDirectory: boolean;
  /** Package name from manifest (if available) */
  packageName?: string;
  /** Whether it's a valid package or plugin */
  isValidPackage?: boolean;
}

export interface BulkInputSpec {
  type: 'bulk';
}

export interface BaseClassifierOptions {
  /** Skip git detection (for performance) */
  skipGit?: boolean;
  /** Skip legacy classifier fallback */
  skipLegacy?: boolean;
}

/**
 * Base classifier - Pure parsing logic without command-specific context.
 * 
 * Extracts common input classification logic shared by install and add commands.
 * Parses user input to determine source type (git, registry, local path, bulk).
 * 
 * @param input - User input string (undefined for bulk)
 * @param cwd - Current working directory
 * @param options - Optional parsing options
 * @returns Base classification with source type and metadata
 * 
 * @example
 * // Git URL
 * const result = await classifyInputBase('gh@owner/repo', '/path/to/workspace');
 * // => { type: 'git', gitUrl: 'https://github.com/owner/repo', derivedName: 'repo' }
 * 
 * @example
 * // Registry package
 * const result = await classifyInputBase('@scope/package@1.0.0', '/path/to/workspace');
 * // => { type: 'registry', packageName: '@scope/package', version: '1.0.0' }
 * 
 * @example
 * // Local path
 * const result = await classifyInputBase('./my-package', '/path/to/workspace');
 * // => { type: 'local-path', absolutePath: '/path/to/workspace/my-package', isDirectory: true }
 */
export async function classifyInputBase(
  input: string | undefined,
  cwd: string,
  options?: BaseClassifierOptions
): Promise<BaseInputClassification> {
  // No input = bulk
  if (!input) {
    return { type: 'bulk' };
  }

  // 1. Try git detection first (non-GitHub URLs)
  if (!options?.skipGit) {
    const gitSpec = detectGitSource(input);
    if (gitSpec && !isGitHubInput(input)) {
      return {
        type: 'git',
        gitUrl: gitSpec.url,
        gitRef: gitSpec.ref,
        gitPath: gitSpec.path,
        derivedName: deriveNameFromGitUrl(gitSpec.url)
      };
    }
  }

  // 2. Try tarball detection
  if (input.endsWith('.tgz') || input.endsWith('.tar.gz')) {
    const resolved = resolve(cwd, input);
    if (await exists(resolved)) {
      return {
        type: 'local-path',
        absolutePath: resolved,
        isDirectory: false
      };
    }
  }

  // 3. Try parseResourceArg (GitHub URLs, gh@, registry, paths)
  try {
    const spec = await parseResourceArg(input, cwd);
    return await convertResourceSpec(spec, cwd);
  } catch (error) {
    // Fall through to legacy
  }

  // 4. Fallback to legacy classifier
  if (!options?.skipLegacy) {
    const legacy = await classifyPackageInput(input, cwd);
    return convertLegacyClassification(legacy);
  }

  // Default to registry
  return {
    type: 'registry',
    packageName: input
  };
}

/**
 * Convert ResourceSpec to BaseInputClassification
 */
async function convertResourceSpec(
  spec: ResourceSpec,
  cwd: string
): Promise<BaseInputClassification> {
  switch (spec.type) {
    case 'github-url':
    case 'github-shorthand':
      return {
        type: 'git',
        gitUrl: spec.gitUrl!,
        gitRef: spec.ref,
        gitPath: spec.path,
        derivedName: spec.repo
      };

    case 'filepath': {
      // Check if it's a valid package
      const isValid = await isValidPackageDirectory(spec.absolutePath!);
      const pluginResult = await detectPluginType(spec.absolutePath!);
      
      let packageName: string | undefined;
      if (isValid || pluginResult.isPlugin) {
        try {
          // Try to load package name from manifest
          const { parsePackageYml } = await import('./package-yml.js');
          const { join } = await import('path');
          const manifestPath = join(spec.absolutePath!, 'openpackage.yml');
          if (await exists(manifestPath)) {
            const config = await parsePackageYml(manifestPath);
            packageName = config.name ?? basename(spec.absolutePath!);
          }
        } catch {
          packageName = basename(spec.absolutePath!);
        }
      }

      return {
        type: 'local-path',
        absolutePath: spec.absolutePath!,
        isDirectory: spec.isDirectory ?? true,
        packageName,
        isValidPackage: isValid || pluginResult.isPlugin
      };
    }

    case 'registry':
      return {
        type: 'registry',
        packageName: spec.name!,
        version: spec.version,
        registryPath: spec.path
      };
  }
}

/**
 * Convert legacy PackageInputClassification to BaseInputClassification
 */
function convertLegacyClassification(
  legacy: Awaited<ReturnType<typeof classifyPackageInput>>
): BaseInputClassification {
  switch (legacy.type) {
    case 'git':
      return {
        type: 'git',
        gitUrl: legacy.gitUrl!,
        gitRef: legacy.gitRef,
        gitPath: legacy.gitPath,
        derivedName: deriveNameFromGitUrl(legacy.gitUrl!)
      };

    case 'directory':
    case 'tarball':
      return {
        type: 'local-path',
        absolutePath: legacy.resolvedPath!,
        isDirectory: legacy.type === 'directory'
      };

    case 'registry':
      return {
        type: 'registry',
        packageName: legacy.name!,
        version: legacy.version,
        registryPath: legacy.registryPath
      };
  }
}

/** Helper: Check if input is GitHub-related */
function isGitHubInput(input: string): boolean {
  return (
    input.startsWith('gh@') ||
    input.startsWith('https://github.com/') ||
    input.startsWith('http://github.com/')
  );
}

/** Helper: Derive package name from git URL */
function deriveNameFromGitUrl(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? url;
}
