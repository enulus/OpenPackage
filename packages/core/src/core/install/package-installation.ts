import { logger } from '../../utils/logger.js';
import type { OutputPort } from '../ports/output.js';
import type { PromptPort } from '../ports/prompt.js';
import { resolveOutput, resolvePrompt } from '../ports/resolve.js';
import type { Platform } from '../../types/platform.js';
import { getDetectedPlatforms, getPlatformDefinitions } from '../platforms.js';
import type { PlatformDefinition } from '../../types/platform.js';

/**
 * Detect existing platforms in the project
 * Wrapper around getDetectedPlatforms that adds debug logging
 */
export async function detectPlatforms(targetDir: string): Promise<Platform[]> {
  const detectedPlatforms = await getDetectedPlatforms(targetDir);

  if (detectedPlatforms.length > 0) {
    logger.debug(`Auto-detected platforms: ${detectedPlatforms.join(', ')}`);
  }

  return detectedPlatforms;
}

/**
 * Prompt user for platform selection when no platforms are detected
 */
export async function promptForPlatformSelection(
  output?: OutputPort,
  prompt?: PromptPort
): Promise<Platform[]> {
  const out = output ?? resolveOutput();
  const prm = prompt ?? resolvePrompt();
  
  out.step('Platform Detection');
  out.info('No AI development platform detected in this project.');

  const choices = Object.values(getPlatformDefinitions()).map((platform: PlatformDefinition) => ({
    title: platform.name,
    value: platform.id
  }));

  const selected = await prm.select<string>(
    'Which platform are you using for AI-assisted development?',
    choices,
    'Use arrow keys to navigate, Enter to select'
  );

  return selected ? [selected as Platform] : [];
}
