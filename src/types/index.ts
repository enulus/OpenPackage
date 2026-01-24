/**
 * Common types and interfaces for the OpenPackage CLI application
 */

import type { Platform } from '../core/platforms.js';

// Re-export flow types
export * from './flows.js';
export * from './platform-flows.js';
export * from './conversion-context.js';

// Core application types
export interface OpenPackageDirectories {
  config: string;
  data: string;
  cache: string;
  runtime: string;
}

export interface ConfigDefaults {
  license?: string;
}

export interface ProfileConfigDefaults {
  author?: string;
  scope?: string;
}

export interface OpenPackageConfig {
  defaults?: ConfigDefaults;
  profiles?: Record<string, ProfileConfig>;
}

export interface ProfileConfig {
  description?: string;
  defaults?: ProfileConfigDefaults;
}

export interface ProfileCredentials {
  api_key: string;
}

export interface Profile {
  name: string;
  config: ProfileConfig;
  credentials?: ProfileCredentials;
}

export interface AuthOptions {
  profile?: string;
  apiKey?: string;
}

// Package types

export interface PackageFile {
  path: string;
  content: string;
  encoding?: string;
}

export interface Package {
  metadata: PackageYml;
  files: PackageFile[];
  /**
   * Internal format metadata (for conversion system)
   * Not serialized or persisted
   */
  _format?: any;  // Import type from format-detector to avoid circular deps
}

export interface PackageRepository {
  type: string
  url: string
  directory?: string
}

// Package.yml file types
export interface PackageDependency {
  name: string;
  /**
   * Registry source (mutually exclusive with path/git).
   */
  version?: string;
  /**
   * Local filesystem source (mutually exclusive with version/git).
   * If ends with .tgz/.tar.gz → tarball, otherwise directory.
   */
  path?: string;
  /**
   * Git source (mutually exclusive with version/path).
   * Supports https/ssh/git URLs; refs handled separately.
   */
  git?: string;
  /**
   * Optional ref (branch/tag/commit) when using git source.
   */
  ref?: string;
  /**
   * Optional subdirectory within git repository (for plugin marketplaces).
   * Example: plugins/commit-commands
   */
  subdirectory?: string;
  /**
   * Optional list of registry-relative paths to install for this dependency.
   * When provided (non-empty), installs are partial and limited to these paths.
   * When omitted, installs include the full package payload.
   */
  include?: string[];
}

export interface PackageYml {
  name: string;
  version?: string;
  private?: boolean;
  partial?: boolean;

  description?: string;
  keywords?: string[];
  author?: string;
  license?: string;
  homepage?: string;
  repository?: PackageRepository;

  packages?: PackageDependency[];
  'dev-packages'?: PackageDependency[];
}

// Command option types

export interface InstallOptions {
  dryRun?: boolean;
  force?: boolean;
  variables?: Record<string, any>;
  dev?: boolean;
  platforms?: string[];
  resolvedPlatforms?: Platform[];
  remote?: boolean;
  local?: boolean;
  profile?: string;
  apiKey?: string;
  conflictStrategy?: 'ask' | 'keep-both' | 'overwrite' | 'skip';
  conflictDecisions?: Record<string, 'keep-both' | 'overwrite' | 'skip'>;
  resolutionMode?: 'default' | 'remote-primary' | 'local-only';
  global?: boolean;
}

export interface UninstallOptions {
  dryRun?: boolean;
  recursive?: boolean;
  global?: boolean;
}

export interface SaveOptions {
  force?: boolean;
  rename?: string;
  platformSpecific?: boolean;
  apply?: boolean;
}

// Registry types
export interface RegistryEntry {
  name: string;
  version: string;
  description?: string;
  author?: string;
  downloadCount?: number;
  lastUpdated: string;
}

// Status and error types
export interface PackageStatus {
  name: string;
  version: string;
  status: 'installed' | 'outdated' | 'modified' | 'error';
  installedAt?: string;
  availableVersion?: string;
}

export interface CommandResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  warnings?: string[];
}

// Error types
export class OpenPackageError extends Error {
  public code: string;
  public details?: any;

  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = 'OpenPackageError';
    this.code = code;
    this.details = details;
  }
}

export enum ErrorCodes {
  PACKAGE_NOT_FOUND = 'PACKAGE_NOT_FOUND',
  PACKAGE_ALREADY_EXISTS = 'PACKAGE_ALREADY_EXISTS',
  INVALID_PACKAGE = 'INVALID_PACKAGE',
  REGISTRY_ERROR = 'REGISTRY_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFIG_ERROR = 'CONFIG_ERROR'
}

// Logger types
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export interface Logger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}

// Conflict resolution types
// Save command discovery type (full metadata)
export interface SaveDiscoveredFile {
  fullPath: string;
  relativePath: string;
  sourceDir: string;
  registryPath: string;
  mtime: number;
  contentHash: string;
  forcePlatformSpecific?: boolean;  // Force platform-specific saving
  isRootFile?: boolean;  // Indicates this is a platform root file (AGENTS.md, CLAUDE.md, etc.)
}

// Backward-compatibility alias until all imports are migrated
export type DiscoveredFile = SaveDiscoveredFile;

// Uninstall command discovery type (minimal fields)
export interface UninstallDiscoveredFile {
  fullPath: string;
  sourceDir: string;
  isRootFile?: boolean;
}

export interface ContentAnalysisResult {
  universalFiles: Array<{
    file: SaveDiscoveredFile;
    finalRegistryPath: string;
  }>;
  platformSpecificFiles: Array<{
    file: SaveDiscoveredFile;
    platformName: string;
    finalRegistryPath: string;
  }>;
}

// ID-based file matching types
export interface FileIdInfo {
  fullPath: string;
  id: string | null;
  packageName: string | null;
  isValid: boolean;
  frontmatter: any | null;
}
