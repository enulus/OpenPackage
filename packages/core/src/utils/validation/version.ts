import * as semver from 'semver';

export interface VersionValidationOptions {
  /** Reject prerelease versions (e.g., 1.0.0-beta) */
  rejectPrerelease?: boolean;
  /** Context for error messages (e.g., "publish", "pack") */
  context?: string;
}

export interface VersionValidationError {
  code: 'MISSING_VERSION' | 'INVALID_VERSION' | 'PRERELEASE_DISALLOWED';
  message: string;
}

/**
 * Validate version string against semver rules
 * Returns error object if invalid, null if valid
 */
export function validateVersion(
  version: string | undefined,
  options: VersionValidationOptions = {}
): VersionValidationError | null {
  if (!version) {
    return {
      code: 'MISSING_VERSION',
      message: `Version field is required${options.context ? ` for ${options.context}` : ''}`
    };
  }
  
  if (!semver.valid(version)) {
    return {
      code: 'INVALID_VERSION',
      message: `Invalid version: ${version}. Must be valid semver (e.g., 1.0.0)`
    };
  }
  
  if (options.rejectPrerelease && semver.prerelease(version)) {
    return {
      code: 'PRERELEASE_DISALLOWED',
      message: `Prerelease versions are not allowed${options.context ? ` for ${options.context}` : ''}: ${version}`
    };
  }
  
  return null;
}

/**
 * Assert version is valid (throws if invalid)
 */
export function assertValidVersion(
  version: string | undefined,
  options?: VersionValidationOptions
): asserts version is string {
  const error = validateVersion(version, options);
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Check if version is unversioned (0.0.0)
 */
export function isUnversionedPackage(version: string | undefined): boolean {
  return version === '0.0.0';
}
