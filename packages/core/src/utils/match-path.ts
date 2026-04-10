import { minimatch } from 'minimatch';

/**
 * Match a package-relative path against a glob pattern.
 *
 * Always enables `dot: true` so that paths containing dot-prefixed segments
 * (e.g. `.opencode/`, `.claude/`) are matched correctly. Without this,
 * `minimatch("root/.opencode/hooks.ts", "**")` returns false — silently
 * dropping files that live under dot-prefixed directories.
 */
export function matchPackagePath(path: string, pattern: string): boolean {
  return minimatch(path, pattern, { dot: true });
}
