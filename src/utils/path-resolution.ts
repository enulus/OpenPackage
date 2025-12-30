import os from 'os';
import path from 'path';

/**
 * Expand leading tilde to the provided home directory.
 * Leaves non-tilde inputs unchanged.
 */
export function expandTildePath(input: string, homeDir: string = os.homedir()): string {
  if (!input.startsWith('~')) {
    return input;
  }

  if (input === '~') {
    return homeDir;
  }

  if (input.startsWith('~/')) {
    return path.join(homeDir, input.slice(2));
  }

  // For forms like ~user/project, fall back to returning as-is
  // to avoid incorrect user resolution on platforms without getpwnam.
  return input;
}

/**
 * Convert an absolute path under ~/.openpackage/ to tilde notation.
 * If the path is not under ~/.openpackage/, returns it unchanged.
 * This ensures registry and packages paths are written with ~ notation in index files.
 * Preserves trailing slashes.
 */
export function toTildePath(absolutePath: string, homeDir: string = os.homedir()): string {
  if (!path.isAbsolute(absolutePath)) {
    // Already relative or tilde notation, return as-is
    return absolutePath;
  }

  // Preserve trailing slash
  const hasTrailingSlash = absolutePath.endsWith(path.sep) || absolutePath.endsWith('/');
  const pathWithoutTrailing = hasTrailingSlash 
    ? absolutePath.slice(0, -1) 
    : absolutePath;

  const normalizedAbsolute = path.normalize(pathWithoutTrailing);
  const normalizedHome = path.normalize(homeDir);
  const openPackageDir = path.join(normalizedHome, '.openpackage');

  // Check if path is under ~/.openpackage/
  if (normalizedAbsolute.startsWith(openPackageDir + path.sep) || normalizedAbsolute === openPackageDir) {
    const relativePath = path.relative(openPackageDir, normalizedAbsolute);
    if (relativePath === '') {
      return '~/.openpackage/';
    }
    // Ensure forward slashes for cross-platform compatibility
    const normalizedRelative = relativePath.split(path.sep).join('/');
    const result = `~/.openpackage/${normalizedRelative}`;
    return hasTrailingSlash ? result + '/' : result;
  }

  // Not under ~/.openpackage/, return as-is (with trailing slash preserved)
  return absolutePath;
}

/**
 * Resolve a declared path (as written in YAML) to an absolute path,
 * while preserving the original declaration for round-tripping.
 */
export function resolveDeclaredPath(
  declaredPath: string,
  referenceFileDir: string
): { declared: string; absolute: string } {
  const declared = declaredPath;

  let expanded = declaredPath;
  if (declaredPath.startsWith('~')) {
    expanded = expandTildePath(declaredPath);
  }

  const absolute = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(referenceFileDir, expanded);

  return {
    declared,
    absolute
  };
}
