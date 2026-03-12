/**
 * Platform Disambiguation
 *
 * Shared utility for resolving a single platform when a workspace resource
 * spans multiple platforms. Used by the move (adopt) and add (resource-ref) flows.
 */

import { getDetectedPlatforms, getPlatformDefinition, resolvePlatformName } from '../platforms.js';
import { disambiguate } from '../resources/disambiguation-prompt.js';
import { ValidationError } from '../../utils/errors.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import { extractPlatformFromPath } from './platform-path-utils.js';

export interface PlatformDisambiguationOptions {
  targetDir: string;
  resourceLabel: string;
  specifiedPlatform?: string;
  execContext?: ExecutionContext;
}

/**
 * Resolve a single platform from detected platforms.
 * - If specifiedPlatform given, validate and return it.
 * - If 1 platform detected, auto-select.
 * - If N detected, prompt (interactive) or error (non-interactive).
 */
export async function disambiguatePlatform(
  options: PlatformDisambiguationOptions,
): Promise<string> {
  const { targetDir, resourceLabel, specifiedPlatform, execContext } = options;

  // --platform flag: validate and return directly
  if (specifiedPlatform) {
    const resolved = resolvePlatformName(specifiedPlatform, targetDir);
    if (!resolved) {
      throw new ValidationError(
        `Unknown platform "${specifiedPlatform}". Run \`opkg ls --platforms\` to see available platforms.`,
      );
    }
    return resolved;
  }

  const detected = await getDetectedPlatforms(targetDir);

  if (detected.length === 0) {
    throw new ValidationError(
      'No platforms detected in the workspace. Cannot determine which platform to use.',
    );
  }

  if (detected.length === 1) {
    return detected[0];
  }

  // Multiple platforms — disambiguate
  const out = resolveOutput(execContext);
  const prm = resolvePrompt(execContext);

  const selected = await disambiguate<string>(
    resourceLabel,
    detected,
    (platform) => {
      const def = getPlatformDefinition(platform, targetDir);
      return {
        title: def.name ?? platform,
        description: platform,
        value: platform,
      };
    },
    {
      notFoundMessage: 'No platforms available for disambiguation.',
      promptMessage: `"${resourceLabel}" exists in multiple platforms. Select one:`,
      multi: false,
    },
    out,
    prm,
  );

  if (selected.length === 0) {
    throw new ValidationError('No platform selected.');
  }

  return selected[0];
}

/**
 * Group workspace file paths by platform.
 * Returns Map<platform | null, paths[]> where null represents universal (non-platform) files.
 */
export function groupFilesByPlatform(
  targetFiles: string[],
  targetDir: string,
): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();

  for (const file of targetFiles) {
    const platform = extractPlatformFromPath(file, targetDir);
    const existing = groups.get(platform);
    if (existing) {
      existing.push(file);
    } else {
      groups.set(platform, [file]);
    }
  }

  return groups;
}
