import { join, basename, resolve } from 'path';

import { exists, isDirectory } from '../../utils/fs.js';
import { classifyInputBase, type BaseInputClassification } from '../../utils/input-classifier-base.js';
import { ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { isValidPackageDirectory } from '../package-context.js';
import { detectPluginType } from '../install/plugin-detector.js';
import { parsePackageYml } from '../../utils/package-yml.js';

export type AddMode = 'dependency' | 'copy' | 'workspace-resource';

export interface AddInputClassification {
  mode: AddMode;
  packageName?: string;
  version?: string;
  gitUrl?: string;
  gitRef?: string;
  gitPath?: string;
  localPath?: string;
  resourcePath?: string;
  copySourcePath?: string;
  /** Resolved workspace resource (for workspace-resource mode) */
  resolvedResource?: import('../resources/resource-builder.js').ResolvedResource;
}

export interface AddClassifyOptions {
  copy?: boolean;
  dev?: boolean;
}

/**
 * Classify add command input to determine mode (dependency vs. copy) and extract metadata.
 *
 * Disambiguation layers (in order):
 * 1. --copy flag → force copy mode
 * 2. Trailing slash → local directory (strip /, resolve, require exists+isDirectory)
 * 3. Bare name with file extension → local file (require exists)
 * 4. Base classifier → registry, git, explicit paths
 *
 * @param input - User input string
 * @param cwd - Current working directory
 * @param options - Add-specific options (--copy, --dev)
 * @returns Add classification with mode and metadata
 */
export async function classifyAddInput(
  input: string,
  cwd: string,
  options: AddClassifyOptions
): Promise<AddInputClassification> {
  // Layer 0: Handle --copy flag first (force copy mode)
  if (options.copy) {
    return handleCopyMode(input, cwd);
  }

  // Layer 1: Trailing slash → local directory (unambiguous dir intent)
  if (input.endsWith('/')) {
    const stripped = input.replace(/\/+$/, '');
    const resolvedPath = resolve(cwd, stripped);
    if (await exists(resolvedPath)) {
      if (await isDirectory(resolvedPath)) {
        const localPathSpec = await buildLocalPathSpec(resolvedPath);
        return enrichWithAddMode(localPathSpec);
      }
      throw new ValidationError(
        `Path '${input}' is not a directory. Trailing slash indicates directory intent.`
      );
    }
    throw new ValidationError(`Directory not found: ${input}`);
  }

  // Layer 2: Bare name with file extension → local file (unambiguous file intent)
  if (isBareNameWithExtension(input)) {
    const resolvedPath = resolve(cwd, input);
    if (await exists(resolvedPath)) {
      return { mode: 'copy', copySourcePath: resolvedPath };
    }
    throw new ValidationError(`File not found: ${input}`);
  }

  // Layer 3: Use base classifier (registry, git, explicit paths)
  const base = await classifyInputBase(input, cwd);
  return enrichWithAddMode(base);
}

/** Check if input is a bare name with a file-extension-like suffix (e.g. README.md, config.json) */
function isBareNameWithExtension(input: string): boolean {
  if (input.startsWith('./') || input.startsWith('../') || input.startsWith('/') || input.startsWith('~')) {
    return false;
  }
  if (input.includes('@') || input.includes('/')) {
    return false;
  }
  // Exclude tarballs — they are packages, not content files
  if (input.endsWith('.tgz') || input.endsWith('.tar.gz')) {
    return false;
  }
  const lastDot = input.lastIndexOf('.');
  if (lastDot <= 0) return false;
  const ext = input.slice(lastDot + 1);
  return ext.length >= 1 && ext.length <= 8 && /^[a-zA-Z0-9]+$/.test(ext);
}

/** Build a LocalPathInputSpec from an absolute path (for trailing-slash and local-path enrichment) */
async function buildLocalPathSpec(absolutePath: string): Promise<BaseInputClassification> {
  const isValid = await isValidPackageDirectory(absolutePath);
  const pluginResult = await detectPluginType(absolutePath);

  let packageName: string | undefined;
  if (isValid || pluginResult.isPlugin) {
    try {
      const manifestPath = join(absolutePath, 'openpackage.yml');
      if (await exists(manifestPath)) {
        const config = await parsePackageYml(manifestPath);
        packageName = config.name ?? basename(absolutePath);
      }
    } catch {
      packageName = basename(absolutePath);
    }
  }

  return {
    type: 'local-path',
    absolutePath,
    isDirectory: true,
    packageName,
    isValidPackage: isValid || pluginResult.isPlugin
  };
}

/**
 * Handle --copy mode (force copy regardless of input type).
 * Accepts any input that resolves to an existing local path (including package directories).
 */
async function handleCopyMode(
  input: string,
  cwd: string
): Promise<AddInputClassification> {
  const resolvedAbsPath = resolve(cwd, input);
  if (!(await exists(resolvedAbsPath))) {
    throw new ValidationError(
      `Path not found: ${input}\n--copy requires an existing local path.`
    );
  }
  return { mode: 'copy', copySourcePath: resolvedAbsPath };
}

/**
 * Enrich base classification with add-specific mode determination
 */
function enrichWithAddMode(
  base: BaseInputClassification
): AddInputClassification {
  switch (base.type) {
    case 'bulk':
      throw new ValidationError('Add command requires an input argument');

    case 'git':
      return {
        mode: 'dependency',
        packageName: base.derivedName!,
        gitUrl: base.gitUrl,
        gitRef: base.gitRef,
        gitPath: base.gitPath
      };

    case 'local-path': {
      // Tarballs (.tgz, .tar.gz) → path dependency
      if (
        base.absolutePath.endsWith('.tgz') ||
        base.absolutePath.endsWith('.tar.gz')
      ) {
        return {
          mode: 'dependency',
          packageName: base.packageName ?? basename(base.absolutePath).replace(/\.(tgz|tar\.gz)$/, ''),
          localPath: base.absolutePath
        };
      }

      // Determine if dependency or copy based on package validity
      if (base.isValidPackage) {
        logger.debug('Classified local directory as dependency', {
          packageName: base.packageName,
          absolutePath: base.absolutePath
        });
        return {
          mode: 'dependency',
          packageName: base.packageName!,
          localPath: base.absolutePath
        };
      }

      // Not a valid package - copy mode
      return {
        mode: 'copy',
        copySourcePath: base.absolutePath
      };
    }

    case 'registry':
      return {
        mode: 'dependency',
        packageName: base.packageName,
        version: base.version,
        resourcePath: base.registryPath
      };
  }
}
