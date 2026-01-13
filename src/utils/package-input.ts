import { resolve, isAbsolute } from 'path';
import { exists } from './fs.js';
import { isValidPackageDirectory } from '../core/package-context.js';
import { parsePackageInstallSpec } from './package-name.js';
import { ValidationError } from './errors.js';
import { parseGitSpec } from './git-spec.js';
import { logger } from './logger.js';
import {
  resolvePackageByName,
  type PackageSourceCandidate,
  type SourceResolutionInfo
} from './package-name-resolution.js';
import { detectPluginType } from '../core/install/plugin-detector.js';
import { DIR_PATTERNS, FILE_PATTERNS, CLAUDE_PLUGIN_PATHS } from '../constants/index.js';

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
  gitSubdirectory?: string;
  
  // For 'directory' or 'tarball' types
  resolvedPath?: string;  // Absolute path
  
  // For version-aware resolution metadata
  sourceComparisonInfo?: SourceResolutionInfo;
}

// Re-export types from package-name-resolution for backward compatibility
export type { PackageSourceCandidate, SourceResolutionInfo as SourceComparisonInfo };

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
      gitRef: gitSpec.ref,
      gitSubdirectory: gitSpec.subdirectory
    };
  }

  // Check for tarball file extension
  const isTarballPath = raw.endsWith(FILE_PATTERNS.TGZ_FILES) || raw.endsWith(FILE_PATTERNS.TAR_GZ_FILES);
  
  // Check if input looks like a path
  const looksLikePath = raw.startsWith('/') ||
                        raw.startsWith('./') ||
                        raw.startsWith('../') ||
                        raw === '.' ||
                        raw.startsWith('~/') ||
                        raw.startsWith(DIR_PATTERNS.OPENPACKAGE + '/') || // Include .openpackage paths
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
    
    // Check if it's a valid package directory OR a plugin
    const isValid = await isValidPackageDirectory(resolvedPath);
    const pluginDetection = await detectPluginType(resolvedPath);
    
    if (isValid || pluginDetection.isPlugin) {
      return { type: 'directory', resolvedPath };
    }
    
    // Path exists but isn't a valid package? Error
    if (await exists(resolvedPath)) {
      throw new ValidationError(
        `Path '${raw}' exists but is not a valid OpenPackage directory or Claude Code plugin. ` +
        `Valid packages must contain ${FILE_PATTERNS.OPENPACKAGE_YML} or ${CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST}`
      );
    }
  }
  
  // Check if this looks like a simple package name (not an explicit path)
  // Search in workspace/global/registry packages using shared resolution
  if (!looksLikePath && !isTarballPath) {
    const resolution = await resolvePackageByName({
      cwd,
      packageName: raw,
      checkCwd: false,          // Install doesn't prioritize CWD
      searchWorkspace: true,    // Search workspace packages
      searchGlobal: true,       // Search global packages  
      searchRegistry: true      // Search registry (install needs this)
    });

    if (resolution.found && resolution.path) {
      logger.info('Resolved package name to path for install', { 
        packageName: raw, 
        path: resolution.path,
        sourceType: resolution.sourceType
      });
      
      return { 
        type: 'directory', 
        resolvedPath: resolution.path,
        sourceComparisonInfo: resolution.resolutionInfo
      };
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


