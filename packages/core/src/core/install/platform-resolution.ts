import { resolvePlatformName, type Platform } from '../platforms.js';
import { normalizePlatforms } from '../platform/platform-mapper.js';
import { detectPlatforms, promptForPlatformSelection } from './package-installation.js';
import type { OutputPort } from '../ports/output.js';
import type { PromptPort } from '../ports/prompt.js';

/**
 * Resolve platforms for an operation.
 * - Uses specified platforms if provided (validated against known platforms)
 * - Otherwise auto-detects
 * - If none detected and interactive=true, prompts user to select
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

  const normalized = normalizePlatforms(specified);
  if (normalized && normalized.length > 0) {
    const resolved = normalized.map(name => resolvePlatformName(name));
    const invalidIndex = resolved.findIndex(platform => !platform);
    if (invalidIndex !== -1) {
      throw new Error(`platform ${normalized[invalidIndex]} not found`);
    }
    return resolved as Platform[];
  }

  const auto = await detectPlatforms(cwd);
  if (auto.length > 0) return auto;

  if (canPrompt) {
    const selected = await promptForPlatformSelection(options.output, options.prompt);
    return selected;
  }

  // Non-interactive with no detected platforms: default to cursor so installs are not silently no-ops.
  return ['cursor'] as Platform[];
}


