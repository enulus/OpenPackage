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
 * Format a path for writing to YAML files (manifest or index).
 * Provides consistent path representation across all workspace YAML files.
 * 
 * Priority:
 * 1. Already relative or tilde notation → return as-is
 * 2. Under workspace root → convert to workspace-relative (./path)
 * 3. Under ~/.openpackage/ → convert to tilde notation (~/.openpackage/path)
 * 4. Other absolute paths → return as-is
 * 
 * @param rawPath - The absolute or relative path to format
 * @param workspaceRoot - The workspace root directory (defaults to process.cwd())
 * @returns Formatted path suitable for YAML files
 */
export function formatPathForYaml(rawPath: string, workspaceRoot: string = process.cwd()): string {
  // If already relative or tilde notation, return as-is
  if (!path.isAbsolute(rawPath)) {
    return rawPath;
  }

  const hasTrailingSlash = rawPath.endsWith(path.sep) || rawPath.endsWith('/');
  const pathWithoutTrailing = hasTrailingSlash ? rawPath.slice(0, -1) : rawPath;

  const normalizedAbs = path.normalize(pathWithoutTrailing);
  const normalizedRoot = path.normalize(workspaceRoot);

  // Convert to workspace-relative path if under workspace
  if (
    normalizedAbs === normalizedRoot ||
    normalizedAbs.startsWith(normalizedRoot + path.sep)
  ) {
    const rel = path.relative(normalizedRoot, normalizedAbs);
    const normalizedRel = rel.split(path.sep).join('/');
    const result = normalizedRel ? `./${normalizedRel}` : './';
    return hasTrailingSlash ? result + '/' : result;
  }

  // For paths outside workspace, convert ~/.openpackage/ to tilde notation
  return toTildePath(rawPath);
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
