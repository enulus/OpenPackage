import { ValidationError } from './errors.js';
import { PackageDependency } from '../types/index.js';

/**
 * Regex pattern for scoped package names (@scope/name or @scope/name/subname/...)
 * Supports multiple slashes for hierarchical names like @anthropics/claude-code/commit-commands
 */
export const SCOPED_PACKAGE_REGEX = /^@([^\/]+)\/(.+)$/;

/**
 * Validate package name according to naming rules
 * @param name - The package name to validate
 * @throws ValidationError if the name is invalid
 */
export function validatePackageName(name: string): void {
  // Check length
  if (name.length === 0) {
    throw new ValidationError('Package name cannot be empty');
  }
  
  if (name.length > 214) {
    throw new ValidationError(`Package name '${name}' is too long (max 214 characters)`);
  }

  // Check for leading/trailing spaces
  if (name.trim() !== name) {
    throw new ValidationError(`Package name '${name}' cannot have leading or trailing spaces`);
  }

  // Check if it's a scoped name (@scope/name format)
  const scopedMatch = name.match(SCOPED_PACKAGE_REGEX);
  if (scopedMatch) {
    const [, scope, localName] = scopedMatch;

    // Validate scope part
    validatePackageNamePart(scope, name, 'scope');

    // Validate local name part
    validatePackageNamePart(localName, name, 'name');

    return;
  }

  // Validate as regular name
  validatePackageNamePart(name, name, 'package');
}

/**
 * Validate a package name part (scope or local name)
 * @param part - The part to validate
 * @param fullName - The full original name for error messages
 * @param partType - The type of part being validated (for better error messages)
 * @throws ValidationError if the part is invalid
 */
function validatePackageNamePart(part: string, fullName: string, partType: string): void {
  // Check for uppercase letters first (most common issue)
  if (/[A-Z]/.test(part)) {
    throw new ValidationError(`Package name '${fullName}' must be lowercase`);
  }

  // Split by slashes to validate each segment individually
  const segments = part.split('/');
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    // Check for empty segments (e.g., double slashes)
    if (!segment || segment.trim() === '') {
      throw new ValidationError(`Package name '${fullName}' cannot have empty segments (consecutive or trailing slashes)`);
    }

    // Check first character of each segment
    if (/^[0-9.\-]/.test(segment)) {
      throw new ValidationError(`Package ${partType} '${fullName}' segment '${segment}' cannot start with a number, dot, or hyphen`);
    }

    // Check for consecutive special characters within a segment
    if (/(\.\.|__|--)/.test(segment)) {
      throw new ValidationError(`Package name '${fullName}' segment '${segment}' cannot have consecutive dots, underscores, or hyphens`);
    }

    // Check allowed characters only (a-z, 0-9, ., _, -, but no slashes within segment)
    if (!/^[a-z0-9._-]+$/.test(segment)) {
      throw new ValidationError(`Package name '${fullName}' segment '${segment}' contains invalid characters (use only: a-z, 0-9, ., _, -)`);
    }
  }
}

/**
 * Parse package input supporting both scoped names (@scope/name) and version specifications (name@version)
 * Returns normalized name and optional version
 */
export function parsePackageInput(packageInput: string): { name: string; version?: string } {
  // Package name with optional version
  const atIndex = packageInput.lastIndexOf('@');

  if (atIndex === -1 || atIndex === 0) {
    validatePackageName(packageInput);
    return {
      name: normalizePackageName(packageInput)
    };
  }

  const name = packageInput.substring(0, atIndex);
  const version = packageInput.substring(atIndex + 1);

  if (!name || !version) {
    throw new ValidationError(`Invalid package syntax: ${packageInput}. Use 'package' or 'package@version'`);
  }

  validatePackageName(name);

  return {
    name: normalizePackageName(name),
    version
  };
}

/**
 * Parse an install spec that may include a registry-relative path:
 *   - name/path
 *   - name@version/path
 * Returns { name, version?, registryPath? }
 */
export function parsePackageInstallSpec(
  raw: string
): { name: string; version?: string; registryPath?: string } {
  // Explicit separator for unambiguous registry paths:
  //   package@1.2.3::rules/foo.md
  //   @scope/name/sub::commands/bar.md
  const explicitSep = raw.indexOf('::');
  if (explicitSep !== -1) {
    const packagePortion = raw.slice(0, explicitSep);
    const registryPath = raw.slice(explicitSep + 2);
    if (!packagePortion || !registryPath) {
      throw new ValidationError(
        `Invalid install spec '${raw}'. Use 'package::path/to/file' or 'package@version::path/to/file'.`
      );
    }
    const { name, version } = parsePackageInput(packagePortion);
    return { name, version, registryPath };
  }

  // Backward-compatible "package/path" parsing, with special handling for scoped
  // hierarchical names like @scope/marketplace/plugin (3+ segments).
  const scopeFirstSlash = raw.startsWith('@') ? raw.indexOf('/', 1) : -1;
  const scopedSecondSlash = scopeFirstSlash !== -1 ? raw.indexOf('/', scopeFirstSlash + 1) : -1;

  const splitSlashIndex = raw.indexOf('/', raw.startsWith('@') ? scopeFirstSlash + 1 : 0);

  // For scoped names, only treat the third segment as registryPath if it looks like a path
  // (contains '/' or '.') to avoid breaking marketplace plugin names like:
  //   @anthropics/claude-plugins-official/github
  if (raw.startsWith('@') && scopedSecondSlash !== -1) {
    const registryPathCandidate = raw.slice(scopedSecondSlash + 1);
    const looksLikeRegistryPath =
      registryPathCandidate.includes('/') || registryPathCandidate.includes('.');
    if (!looksLikeRegistryPath) {
      // Treat the whole string as the package name.
      return parsePackageInput(raw);
    }
  }

  if (splitSlashIndex === -1) {
    // No path portion; fall back to standard parsing
    return parsePackageInput(raw);
  }

  const packagePortion = raw.slice(0, splitSlashIndex);
  const registryPath = raw.slice(splitSlashIndex + 1);
  if (!registryPath) {
    throw new ValidationError(
      `Invalid install spec '${raw}'. Provide a registry path after the package name, e.g. package/path/to/file.md.`
    );
  }

  const { name, version } = parsePackageInput(packagePortion);
  return { name, version, registryPath };
}

/**
 * Parse a push spec that may include a registry-relative path (same format as install):
 *   - name/path
 *   - name@version/path
 * Returns { name, version?, registryPath? }
 */
export function parsePackagePushSpec(
  raw: string
): { name: string; version?: string; registryPath?: string } {
  return parsePackageInstallSpec(raw);
}

/**
 * Normalize a package name to lowercase, handling scoped names properly.
 * Scoped names like @Scope/Name become @scope/name.
 * Regular names like MyPackage become mypackage.
 */
export function normalizePackageName(name: string): string {
  return name.toLowerCase();
}


/**
 * Check if two package names are equivalent (case-insensitive).
 */
export function arePackageNamesEquivalent(name1: string, name2: string): boolean {
  return normalizePackageName(name1) === normalizePackageName(name2);
}