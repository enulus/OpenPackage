import { resolve, basename, extname } from 'path';
import { exists } from '../../utils/fs.js';
import { parseResourceArg, type ResourceSpec } from '../../utils/resource-arg-parser.js';
import { classifyPackageInput } from '../../utils/package-input.js';
import { isValidPackageDirectory, loadPackageConfig } from '../package-context.js';
import { detectPluginType } from '../install/plugin-detector.js';
import { detectGitSource } from '../../utils/git-url-detection.js';
import { ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

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

function looksLikePath(input: string): boolean {
  return input.startsWith('/') || input.startsWith('./') || input.startsWith('../') || input.startsWith('~') || input === '.';
}

function deriveNameFromGitUrl(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? url;
}

export async function classifyAddInput(
  input: string,
  cwd: string,
  options: AddClassifyOptions
): Promise<AddInputClassification> {
  // 1. --copy flag
  if (options.copy) {
    if (!looksLikePath(input)) {
      throw new ValidationError('--copy can only be used with local paths');
    }
    const resolvedAbsPath = resolve(cwd, input);
    if (!(await exists(resolvedAbsPath))) {
      throw new ValidationError(`Path not found: ${input}`);
    }
    return { mode: 'copy', copySourcePath: resolvedAbsPath };
  }

  // 2. Check for generic git URLs and tarballs first — parseResourceArg doesn't handle these
  const gitSpec = detectGitSource(input);
  if (gitSpec && !input.startsWith('gh@') && !input.startsWith('https://github.com/') && !input.startsWith('http://github.com/')) {
    return {
      mode: 'dependency',
      packageName: deriveNameFromGitUrl(gitSpec.url),
      gitUrl: gitSpec.url,
      gitRef: gitSpec.ref,
      gitPath: gitSpec.path,
    };
  }

  if (input.endsWith('.tgz') || input.endsWith('.tar.gz')) {
    const resolved = resolve(cwd, input);
    if (await exists(resolved)) {
      return {
        mode: 'dependency',
        packageName: basename(resolved, extname(resolved)),
        localPath: resolved,
      };
    }
  }

  // 3. Try parseResourceArg
  try {
    const spec = await parseResourceArg(input, cwd);

    if (spec.type === 'github-url' || spec.type === 'github-shorthand') {
      return {
        mode: 'dependency',
        packageName: spec.repo,
        gitUrl: spec.gitUrl,
        gitRef: spec.ref,
        gitPath: spec.path,
      };
    }

    if (spec.type === 'registry') {
      return {
        mode: 'dependency',
        packageName: spec.name,
        version: spec.version,
        resourcePath: spec.path,
      };
    }

    if (spec.type === 'filepath') {
      if (spec.isDirectory === false) {
        return { mode: 'copy', copySourcePath: spec.absolutePath };
      }

      const absolutePath = spec.absolutePath!;
      const [isPackage, pluginResult] = await Promise.all([
        isValidPackageDirectory(absolutePath),
        detectPluginType(absolutePath),
      ]);

      if (isPackage || pluginResult.isPlugin) {
        const config = await loadPackageConfig(absolutePath);
        const packageName = config?.name ?? basename(absolutePath);
        logger.debug('Classified local directory as dependency', { packageName, absolutePath });
        return { mode: 'dependency', packageName, localPath: absolutePath };
      }

      return { mode: 'copy', copySourcePath: absolutePath };
    }
  } catch {
    // Fall through to workspace resource check / legacy classifier
  }

  // 3.5. Check if input matches an installed workspace resource by name
  if (!looksLikePath(input) && !options.copy) {
    try {
      const { resolveByName } = await import('../resources/resource-resolver.js');
      const { traverseScopesFlat } = await import('../resources/scope-traversal.js');

      const resourceCandidates = await traverseScopesFlat(
        {},
        async ({ scope, context }) => {
          const result = await resolveByName(input, context.targetDir, scope);
          return result.candidates
            .filter(c => c.kind === 'resource' && c.resource)
            .map(c => c.resource!);
        }
      );

      if (resourceCandidates.length > 0) {
        logger.debug('Matched workspace resource for add', { input, count: resourceCandidates.length });
        return {
          mode: 'workspace-resource' as AddMode,
          resolvedResource: resourceCandidates[0],
        };
      }
    } catch (error) {
      logger.debug('Workspace resource check skipped for add', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 4. Fallback: classifyPackageInput
  const legacy = await classifyPackageInput(input, cwd);

  if (legacy.type === 'git') {
    return {
      mode: 'dependency',
      packageName: deriveNameFromGitUrl(legacy.gitUrl!),
      gitUrl: legacy.gitUrl,
      gitRef: legacy.gitRef,
      gitPath: legacy.gitPath,
    };
  }

  if (legacy.type === 'tarball') {
    return {
      mode: 'dependency',
      packageName: basename(legacy.resolvedPath!, extname(legacy.resolvedPath!)),
      localPath: legacy.resolvedPath,
    };
  }

  if (legacy.type === 'directory') {
    const config = await loadPackageConfig(legacy.resolvedPath!);
    const packageName = config?.name ?? basename(legacy.resolvedPath!);
    return { mode: 'dependency', packageName, localPath: legacy.resolvedPath };
  }

  // registry
  return {
    mode: 'dependency',
    packageName: legacy.name,
    version: legacy.version,
    resourcePath: legacy.registryPath,
  };
}
