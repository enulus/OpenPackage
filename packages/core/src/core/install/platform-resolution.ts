import { join } from 'path';
import { resolvePlatformName, type Platform } from '../platforms.js';
import { normalizePlatforms } from '../platform/platform-mapper.js';
import { detectPlatforms, promptForPlatformSelection } from './package-installation.js';
import { getLocalOpenPackageDir } from '../../utils/paths.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { logger } from '../../utils/logger.js';
import type { OutputPort } from '../ports/output.js';
import type { PromptPort } from '../ports/prompt.js';

/**
 * Resolve platforms for an operation.
 * Resolution priority: CLI flag > manifest field > auto-detection > prompt/default
 *
 * The `interactive` flag is typically derived from
 * `InteractionPolicy.canPrompt(PromptTier.Required)` at the call site.
 */
export async function resolvePlatforms(
  cwd: string,
  specified: string[] | undefined,
  options: { interactive?: boolean; output?: OutputPort; prompt?: PromptPort } = {}
): Promise<Platform[]> {
  const canPrompt = options.interactive === true;

  // 1. CLI --platforms flag
  const normalized = normalizePlatforms(specified);
  if (normalized && normalized.length > 0) {
    const resolved = normalized.map(name => resolvePlatformName(name));
    const invalidIndex = resolved.findIndex(platform => !platform);
    if (invalidIndex !== -1) {
      throw new Error(`platform ${normalized[invalidIndex]} not found`);
    }
    return resolved as Platform[];
  }

  // 2. Manifest platforms: field
  const manifestPlatforms = await readManifestPlatforms(cwd);
  if (manifestPlatforms) return manifestPlatforms;

  // 3. Auto-detect
  const auto = await detectPlatforms(cwd);
  if (auto.length > 0) return auto;

  // 4. Interactive prompt
  if (canPrompt) {
    const selected = await promptForPlatformSelection(options.output, options.prompt);
    return selected;
  }

  // 5. Default to cursor
  return ['cursor'] as Platform[];
}

/**
 * Read platforms from the workspace manifest, returning null if unavailable.
 * Separates I/O errors (fall through) from validation errors (thrown).
 */
async function readManifestPlatforms(cwd: string): Promise<Platform[] | null> {
  let manifest;
  try {
    const opkgDir = getLocalOpenPackageDir(cwd);
    const manifestPath = join(opkgDir, FILE_PATTERNS.OPENPACKAGE_YML);
    manifest = await parsePackageYml(manifestPath);
  } catch {
    // Manifest missing or unreadable — fall through to auto-detect
    logger.debug('Could not read manifest platforms, falling through to auto-detect');
    return null;
  }

  if (!manifest.platforms || manifest.platforms.length === 0) return null;

  // Validate outside the try/catch so validation errors propagate
  const resolved = manifest.platforms.map(name => resolvePlatformName(name));
  const invalidIndex = resolved.findIndex(p => !p);
  if (invalidIndex !== -1) {
    throw new Error(`platform ${manifest.platforms[invalidIndex]} in manifest not found`);
  }
  logger.debug('Using manifest platforms:', manifest.platforms);
  return resolved as Platform[];
}
