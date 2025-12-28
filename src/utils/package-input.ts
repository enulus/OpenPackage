import { resolve, isAbsolute } from 'path';
import { exists } from './fs.js';
import { isValidPackageDirectory } from '../core/package-context.js';
import { parsePackageInstallSpec } from './package-name.js';
import { ValidationError } from './errors.js';
import { parseGitSpec } from './git-spec.js';

export type PackageInputType = 'registry' | 'directory' | 'tarball' | 'git';

export interface PackageInputClassification {
  type: PackageInputType;
  
  // For 'registry' type
  name?: string;
  version?: string;
  registryPath?: string;

  // For 'git' type
  gitUrl?: string;
  gitRef?: string;
  
  // For 'directory' or 'tarball' types
  resolvedPath?: string;  // Absolute path
}

/**
 * Classify whether input is a registry package name, local directory, or tarball.
 * 
 * Detection order:
 * 1. Ends with .tgz or .tar.gz AND file exists → 'tarball'
 * 2. Starts with /, ./, ../, or is . AND isValidPackageDirectory → 'directory'
 * 3. Otherwise → parse as registry name via parsePackageInstallSpec
 * 
 * @param raw - The raw input string from the user
 * @param cwd - Current working directory for resolving relative paths
 * @returns Classification of the input type and relevant information
 */
export async function classifyPackageInput(
  raw: string,
  cwd: string = process.cwd()
): Promise<PackageInputClassification> {
  // Check for git/github specs first
  const gitSpec = parseGitSpec(raw);
  if (gitSpec) {
    return {
      type: 'git',
      gitUrl: gitSpec.url,
      gitRef: gitSpec.ref
    };
  }

  // Check for tarball file extension
  const isTarballPath = raw.endsWith('.tgz') || raw.endsWith('.tar.gz');
  
  // Check if input looks like a path
  const looksLikePath = raw.startsWith('/') || 
                        raw.startsWith('./') || 
                        raw.startsWith('../') || 
                        raw === '.' ||
                        (isAbsolute(raw) && !raw.includes('@'));
  
  if (isTarballPath || looksLikePath) {
    const resolvedPath = isAbsolute(raw) ? raw : resolve(cwd, raw);
    
    if (isTarballPath) {
      if (await exists(resolvedPath)) {
        return { type: 'tarball', resolvedPath };
      }
      // File doesn't exist - fall through to treat as registry name
      // (will error later with "file not found" or "package not found")
    }
    
    if (await isValidPackageDirectory(resolvedPath)) {
      return { type: 'directory', resolvedPath };
    }
    
    // Path exists but isn't a valid package? Error
    if (await exists(resolvedPath)) {
      throw new ValidationError(
        `Path '${raw}' exists but is not a valid OpenPackage directory. ` +
        `Valid packages must contain .openpackage/package.yml`
      );
    }
  }
  
  // Treat as registry package name
  try {
    const { name, version, registryPath } = parsePackageInstallSpec(raw);
    return { type: 'registry', name, version, registryPath };
  } catch (error) {
    // If parsing fails, still return registry type - let downstream handle the error
    return { type: 'registry', name: raw };
  }
}

