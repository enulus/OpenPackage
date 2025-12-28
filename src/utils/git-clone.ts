import { execFile } from 'child_process';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

import { logger } from './logger.js';
import { ValidationError } from './errors.js';
import { exists } from './fs.js';
import { DIR_PATTERNS, FILE_PATTERNS } from '../constants/index.js';

const execFileAsync = promisify(execFile);

export interface GitCloneOptions {
  url: string;
  ref?: string; // branch/tag/sha
}

function isSha(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref);
}

async function runGit(args: string[], cwd?: string): Promise<void> {
  try {
    await execFileAsync('git', args, { cwd });
  } catch (error: any) {
    const message = error?.stderr?.toString?.().trim?.() || error?.message || String(error);
    throw new ValidationError(`Git command failed: ${message}`);
  }
}

export async function cloneRepoToTempDir(options: GitCloneOptions): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-git-'));
  const { url, ref } = options;

  if (ref && isSha(ref)) {
    // SHA: shallow clone default branch, then fetch the sha
    await runGit(['clone', '--depth', '1', url, tempDir]);
    await runGit(['fetch', '--depth', '1', 'origin', ref], tempDir);
    await runGit(['checkout', ref], tempDir);
  } else if (ref) {
    // Branch or tag
    await runGit(['clone', '--depth', '1', '--branch', ref, url, tempDir]);
  } else {
    // Default branch
    await runGit(['clone', '--depth', '1', url, tempDir]);
  }

  // Validate OpenPackage root
  const manifestPath = join(tempDir, DIR_PATTERNS.OPENPACKAGE, FILE_PATTERNS.PACKAGE_YML);
  if (!(await exists(manifestPath))) {
    throw new ValidationError(
      `Cloned repository is not an OpenPackage (missing ${DIR_PATTERNS.OPENPACKAGE}/${FILE_PATTERNS.PACKAGE_YML})`
    );
  }

  logger.debug(`Cloned git repository ${url}${ref ? `#${ref}` : ''} to ${tempDir}`);
  return tempDir;
}
