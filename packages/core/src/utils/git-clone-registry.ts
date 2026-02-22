import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

import { getRegistryDirectories } from '../core/directory.js';
import { ensureDir, exists } from './fs.js';
import { FILE_PATTERNS, GIT, REGISTRY_PATH_PREFIXES } from '../constants/index.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface GitCloneRegistryOptions {
  url: string;
  ref?: string; // branch/tag/sha
}

export interface GitCloneRegistryResult {
  absolutePath: string;
  declaredPath: string;
  user: string;
  repo: string;
  refOrHead: string;
}

interface ParsedGitUrl {
  user: string;
  repo: string;
}

function parseGitUrl(url: string): ParsedGitUrl {
  // Supports HTTPS and SSH forms for GitHub-like URLs.
  // Examples:
  //   https://github.com/user/repo.git
  //   git@github.com:user/repo.git
  const httpsMatch = url.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(\.git)?$/);
  if (httpsMatch) {
    return { user: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = url.match(/^git@[^:]+:([^/]+)\/([^/]+?)(\.git)?$/);
  if (sshMatch) {
    return { user: sshMatch[1], repo: sshMatch[2] };
  }

  throw new Error(`Unsupported git URL format: ${url}`);
}

function sanitizeRef(ref?: string): string {
  if (!ref || ref.trim().length === 0) return GIT.DEFAULT_REF;
  return ref.replace(/[\\/]+/g, '_');
}

async function runGit(args: string[], cwd?: string): Promise<void> {
  const meta = { args, cwd };
  logger.debug('Running git', meta);
  try {
    await execFileAsync('git', args, { cwd });
  } catch (error: any) {
    const message = error?.stderr?.toString?.().trim?.() || error?.message || String(error);
    throw new Error(`Git command failed (${args.join(' ')}): ${message}`);
  }
}

async function ensureOpenPackageManifestExists(dir: string): Promise<void> {
  const manifestPath = path.join(dir, FILE_PATTERNS.OPENPACKAGE_YML);
  if (!(await exists(manifestPath))) {
    throw new Error(
      `Cloned repository at ${dir} is not an OpenPackage (missing ${FILE_PATTERNS.OPENPACKAGE_YML})`
    );
  }
}

/**
 * Clone or update a git source into the local registry under:
 *   ~/.openpackage/registry/git/<user>/<repo>/<refOrHead>/
 *
 * Returns the absolute path and a tilde-preserved declared path.
 */
export async function cloneGitToRegistry(
  options: GitCloneRegistryOptions
): Promise<GitCloneRegistryResult> {
  const { url, ref } = options;
  const { user, repo } = parseGitUrl(url);
  const refOrHead = sanitizeRef(ref);

  const { packages: registryRoot } = getRegistryDirectories();
  const targetDir = path.join(registryRoot, GIT.DIRECTORY, user, repo, refOrHead);

  await ensureDir(path.dirname(targetDir));

  const targetExists = await exists(targetDir);
  if (!targetExists) {
    const cloneArgs: string[] = [GIT.COMMANDS.CLONE, GIT.COMMANDS.DEPTH_FLAG, GIT.COMMANDS.DEPTH_VALUE];
    if (ref) {
      cloneArgs.push(GIT.COMMANDS.BRANCH_FLAG, ref);
    }
    cloneArgs.push(url, targetDir);
    await runGit(cloneArgs);
  } else {
    // Refresh existing clone
    if (ref) {
      await runGit(
        [GIT.COMMANDS.FETCH, GIT.COMMANDS.DEPTH_FLAG, GIT.COMMANDS.DEPTH_VALUE, GIT.COMMANDS.ORIGIN, ref] as string[],
        targetDir
      );
      await runGit([GIT.COMMANDS.CHECKOUT, ref] as string[], targetDir);
    } else {
      await runGit([GIT.COMMANDS.PULL], targetDir);
    }
  }

  await ensureOpenPackageManifestExists(targetDir);

  const declaredPath = `${REGISTRY_PATH_PREFIXES.GIT}${user}/${repo}/${refOrHead}/`;
  return {
    absolutePath: path.join(targetDir, path.sep),
    declaredPath,
    user,
    repo,
    refOrHead
  };
}
