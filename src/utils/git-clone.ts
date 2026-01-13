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
  subdirectory?: string; // subdirectory within repository
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
  const { url, ref, subdirectory } = options;

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

  // Resolve final path (repository root or subdirectory)
  let finalPath = tempDir;
  if (subdirectory) {
    finalPath = join(tempDir, subdirectory);
    if (!(await exists(finalPath))) {
      throw new ValidationError(
        `Subdirectory '${subdirectory}' does not exist in cloned repository ${url}`
      );
    }
    logger.debug(`Resolved subdirectory within repository`, { subdirectory, finalPath });
  }

  // Validate OpenPackage root (v2 layout: openpackage.yml at repository root or subdirectory root)
  // Note: For plugins, this validation will be skipped since plugins use .claude-plugin/plugin.json
  const manifestPath = join(finalPath, FILE_PATTERNS.OPENPACKAGE_YML);
  const hasManifest = await exists(manifestPath);
  
  // Check for plugin manifest as alternative
  const pluginManifestPath = join(finalPath, DIR_PATTERNS.CLAUDE_PLUGIN, FILE_PATTERNS.PLUGIN_JSON);
  const hasPluginManifest = await exists(pluginManifestPath);
  
  // Check for marketplace manifest as alternative
  const marketplaceManifestPath = join(finalPath, DIR_PATTERNS.CLAUDE_PLUGIN, FILE_PATTERNS.MARKETPLACE_JSON);
  const hasMarketplaceManifest = await exists(marketplaceManifestPath);
  
  if (!hasManifest && !hasPluginManifest && !hasMarketplaceManifest) {
    throw new ValidationError(
      `Cloned repository is not an OpenPackage or Claude Code plugin ` +
      `(missing ${FILE_PATTERNS.OPENPACKAGE_YML}, ${DIR_PATTERNS.CLAUDE_PLUGIN}/${FILE_PATTERNS.PLUGIN_JSON}, or ${DIR_PATTERNS.CLAUDE_PLUGIN}/${FILE_PATTERNS.MARKETPLACE_JSON} ` +
      `at ${subdirectory ? `subdirectory '${subdirectory}'` : 'repository root'})`
    );
  }

  const refPart = ref ? `#${ref}` : '';
  const subdirPart = subdirectory ? `&subdirectory=${subdirectory}` : '';
  logger.debug(`Cloned git repository ${url}${refPart}${subdirPart} to ${finalPath}`);
  return finalPath;
}
