import { getInstallableTypes } from '../resources/resource-registry.js';

export function normalizeConvertedMatchedPattern(
  matchedPattern: string | undefined
): string | undefined {
  if (!matchedPattern) {
    return matchedPattern;
  }

  const normalized = matchedPattern.replace(/\\/g, '/').replace(/^\.\/?/, '');
  const hasRecursiveSuffix = normalized.endsWith('/**');
  const patternBase = hasRecursiveSuffix ? normalized.slice(0, -3) : normalized;
  const segments = patternBase.split('/').filter(Boolean);

  for (const type of getInstallableTypes()) {
    if (!type.dirName) {
      continue;
    }

    const anchorIndex = segments.lastIndexOf(type.dirName);
    if (anchorIndex === -1) {
      continue;
    }

    const anchoredPath = segments.slice(anchorIndex).join('/');
    return hasRecursiveSuffix ? `${anchoredPath}/**` : anchoredPath;
  }

  return normalized;
}
