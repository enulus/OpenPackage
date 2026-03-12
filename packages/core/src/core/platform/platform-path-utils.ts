/**
 * Platform Path Utilities
 *
 * Shared helpers for mapping workspace file paths to platform IDs.
 * Extracted from list-pipeline so move, add, and list can all reuse them.
 */

import { getAllPlatforms, getPlatformDefinition, isPlatformId } from '../platforms.js';
import { DIR_TO_TYPE } from '../resources/resource-registry.js';

/**
 * Extract the root directory prefix from a `to` pattern string.
 * e.g. ".cursor/agents/x.md" -> ".cursor", ".config/opencode/agents/x.md" -> ".config/opencode"
 * Returns null for patterns without a dot-prefixed root dir.
 */
export function extractRootPrefixFromToPattern(pattern: string): string | null {
  const parts = pattern.replace(/\\/g, '/').split('/');
  if (parts.length < 2 || !parts[0].startsWith('.')) return null;
  const nonGlobParts = [];
  for (const part of parts) {
    if (part.includes('*') || part.includes('{')) break;
    nonGlobParts.push(part);
  }
  if (nonGlobParts.length < 2) return nonGlobParts.length === 1 ? nonGlobParts[0] : null;
  // For paths like ".config/opencode/agents/foo.md", the root prefix is everything
  // up to but not including known resource type dirs or the filename.
  const resourceDirs = new Set(Object.keys(DIR_TO_TYPE));
  const prefixParts = [];
  for (const part of nonGlobParts) {
    if (resourceDirs.has(part)) break;
    if (part.includes('.') && part !== nonGlobParts[0]) break;
    prefixParts.push(part);
  }
  return prefixParts.length > 0 ? prefixParts.join('/') : null;
}

/**
 * Collect all `to` pattern strings from a flow, including $switch cases.
 */
export function collectToPatternsFromFlow(toField: unknown): string[] {
  if (typeof toField === 'string') return [toField];

  if (typeof toField === 'object' && toField !== null) {
    if ('$switch' in toField) {
      const sw = (toField as any).$switch;
      const patterns: string[] = [];
      for (const c of sw?.cases ?? []) {
        const v = c.value;
        if (typeof v === 'string') patterns.push(v);
        else if (typeof v === 'object' && v && 'pattern' in v) patterns.push(v.pattern);
      }
      const d = sw?.default;
      if (typeof d === 'string') patterns.push(d);
      else if (typeof d === 'object' && d && 'pattern' in d) patterns.push(d.pattern);
      return patterns;
    }
    if ('pattern' in toField && typeof (toField as any).pattern === 'string') {
      return [(toField as any).pattern];
    }
  }
  return [];
}

/**
 * Build a mapping from root directory prefixes to platform IDs.
 * Collects all root prefixes from every export flow `to` pattern (including $switch cases).
 * Cached per targetDir to avoid recomputing on every file.
 */
const rootDirCacheMap = new Map<string, Map<string, string>>();
const sortedEntriesCache = new Map<string, Array<[string, string]>>();

export function getRootDirToPlatformMap(targetDir: string): Map<string, string> {
  const cached = rootDirCacheMap.get(targetDir);
  if (cached) return cached;

  const map = new Map<string, string>();
  for (const platform of getAllPlatforms({ includeDisabled: true }, targetDir)) {
    const definition = getPlatformDefinition(platform, targetDir);
    if (!definition.export) continue;
    for (const flow of definition.export) {
      for (const pattern of collectToPatternsFromFlow(flow.to)) {
        const prefix = extractRootPrefixFromToPattern(pattern);
        if (prefix && !map.has(prefix)) {
          map.set(prefix, platform);
        }
      }
    }
  }
  rootDirCacheMap.set(targetDir, map);
  sortedEntriesCache.delete(targetDir);
  return map;
}

function getSortedRootDirEntries(targetDir: string): Array<[string, string]> {
  const cached = sortedEntriesCache.get(targetDir);
  if (cached) return cached;

  const rootDirMap = getRootDirToPlatformMap(targetDir);
  const sorted = [...rootDirMap.entries()].sort((a, b) => b[0].length - a[0].length);
  sortedEntriesCache.set(targetDir, sorted);
  return sorted;
}

/**
 * Extract platform from a target path by matching its root directory against
 * known platform root directories derived from export flows.
 * Returns null if the file is universal (no platform).
 *
 * @param targetPath - Target path relative to workspace (e.g., ".cursor/agents/foo.md")
 * @param targetDir - Target directory for context and flow resolution
 * @returns Platform ID or null if universal
 */
export function extractPlatformFromPath(targetPath: string, targetDir: string): string | null {
  const normalized = targetPath.replace(/\\/g, '/');

  // Check if the path starts with a known platform root directory
  // Sorted by longest prefix first so more-specific prefixes match before shorter ones
  for (const [rootDir, platform] of getSortedRootDirEntries(targetDir)) {
    if (normalized === rootDir || normalized.startsWith(rootDir + '/')) {
      return platform;
    }
  }

  // Fallback: Check for platform suffix in filename (e.g., mcp.cursor.jsonc, rule.claude.md)
  const parts = normalized.split('/');
  const filename = parts[parts.length - 1];
  const nameParts = filename.split('.');

  // Need at least 3 parts: name.platform.ext
  if (nameParts.length >= 3) {
    const possiblePlatform = nameParts[nameParts.length - 2];
    if (isPlatformId(possiblePlatform, targetDir)) {
      return possiblePlatform;
    }
  }

  // No platform detected - this is a universal file
  return null;
}
