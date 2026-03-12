/**
 * Type definitions for the sync subsystem
 *
 * Defines core data structures used across all phases of the sync pipeline,
 * including direction, conflict strategies, file actions, and result shapes.
 */

import type { ContentStatus } from '../list/content-status-checker.js';

export type SyncConflictStrategy = 'workspace' | 'source' | 'skip' | 'auto';
export type SyncDirection = 'push' | 'pull' | 'bidirectional';

export interface SyncOptions {
  direction: SyncDirection;
  dryRun: boolean;
  conflicts?: SyncConflictStrategy;
  platforms?: string[];
  /** Push-specific: prefer specified platform version for save conflicts */
  prefer?: string;
  /** Version range override from @<range> notation */
  versionOverride?: string;
  /** Preserve original --force flag (separate from conflicts strategy) */
  force?: boolean;
}

export type SyncFileAction =
  | { type: 'push'; sourceKey: string; targetPath: string }
  | { type: 'pull'; sourceKey: string; targetPath: string }
  | { type: 'remove'; sourceKey: string; targetPath: string }
  | { type: 'conflict'; sourceKey: string; targetPath: string; resolution?: 'workspace' | 'source' | 'skip' }
  | { type: 'skip'; sourceKey: string; targetPath: string; reason: string };

export interface SyncPackageResult {
  packageName: string;
  pushed: number;
  pulled: number;
  removed: number;
  skipped: number;
  errors: number;
  files: SyncFileResult[];
  versionUpdate?: {
    oldVersion?: string;
    newVersion: string;
    oldRange?: string;
    newRange?: string;
  };
}

export interface SyncFileResult {
  sourceKey: string;
  targetPath: string;
  action: 'pushed' | 'pulled' | 'removed' | 'skipped' | 'error';
  operation?: 'created' | 'updated';
  detail?: string;
}

export interface SyncAllResult {
  json: SyncAllJsonOutput;
  summary: string;
}

export interface SyncAllJsonOutput {
  packages: Array<{
    packageName: string;
    status: 'synced' | 'no-changes' | 'error';
    result?: SyncPackageResult;
    error?: string;
  }>;
  totals: {
    packagesProcessed: number;
    packagesWithChanges: number;
    packagesFailed: number;
    totalFilesPushed: number;
    totalFilesPulled: number;
    totalFilesRemoved: number;
  };
}

/** Lightweight info about a syncable package discovered during sync-all */
export interface SyncablePackageInfo {
  packageName: string;
  /** Which directions have actionable files */
  directions: Set<'push' | 'pull'>;
}

/** Map of sourceKey::targetPath → ContentStatus, reused from content-status-checker */
export type StatusMap = Map<string, ContentStatus>;
