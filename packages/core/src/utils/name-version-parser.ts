/**
 * Name-Version Parser
 *
 * Parses `@<range>` from a name argument for version override notation.
 * Used by sync and install CLI commands to allow inline range overrides
 * like `opkg sync my-pkg@^2.0.0`.
 */

export interface NameWithVersionOverride {
  name: string;
  versionOverride?: string;
}

/**
 * Parse a name argument that may contain a `@<range>` suffix.
 *
 * - Skips `gh@` prefixed inputs (git shorthand)
 * - Skips if `atIndex <= 0` (no `@` or scoped package prefix)
 * - Validates the after-`@` segment looks like a version/range
 */
export function parseNameWithVersionOverride(input: string): NameWithVersionOverride {
  // Skip gh@ prefixed inputs (git shorthand like gh@owner/repo)
  if (input.startsWith('gh@')) {
    return { name: input };
  }

  const atIndex = input.lastIndexOf('@');

  // No @ found, or @ is at position 0 (scoped package like @scope/pkg)
  if (atIndex <= 0) {
    return { name: input };
  }

  const afterAt = input.slice(atIndex + 1);

  // Must not contain '/' (that would be a path, not a version)
  if (afterAt.includes('/')) {
    return { name: input };
  }

  // Must start with a digit, or one of ^~*>=<  (looks like a version/range)
  if (!/^[\d^~*>=<]/.test(afterAt)) {
    return { name: input };
  }

  return {
    name: input.slice(0, atIndex),
    versionOverride: afterAt,
  };
}
