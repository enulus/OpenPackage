import { FILE_PATTERNS } from '../constants/index.js';
import type { Platform } from '../types/platform.js';
import {
  deepEqualYaml,
  deepMerge,
  extractInlinePlatformOverrides,
  splitFrontmatter,
  composeMarkdown
} from './markdown-frontmatter.js';

/**
 * Merge inline platform-specific override with universal content.
 * - Frontmatter contains common keys and platform-keyed override blocks.
 * - Produces merged frontmatter (common + override[targetPlatform]) and
 *   removes platform blocks in the emitted markdown.
 */
export function mergeInlinePlatformOverride(
  universalContent: string,
  targetPlatform: Platform,
  cwd?: string
): string {
  try {
    const trimmed = universalContent.trim();
    if (!trimmed.endsWith(FILE_PATTERNS.MD_FILES) && !trimmed.startsWith('---')) {
      // Fast path: only attempt merge for markdown with potential frontmatter
      return universalContent;
    }

    const { frontmatter, body, rawFrontmatter } = splitFrontmatter(universalContent);
    const { common, overridesByPlatform } = extractInlinePlatformOverrides(frontmatter, cwd);
    const override = overridesByPlatform.get(targetPlatform) ?? {};

    const mergedData = deepMerge(common, override);

    // Avoid reformatting if there's no change compared to base.
    // If frontmatter was present, check deep equality.
    if (rawFrontmatter !== undefined && deepEqualYaml(frontmatter, mergedData)) {
      return universalContent;
    }

    // If no frontmatter was present and merged result is empty, return original.
    if (rawFrontmatter === undefined && Object.keys(mergedData).length === 0) {
      return universalContent;
    }

    return composeMarkdown(mergedData, body);
  } catch {
    return universalContent;
  }
}
