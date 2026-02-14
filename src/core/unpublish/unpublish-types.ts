import type { CommandResult } from '../../types/index.js';

export interface UnpublishOptions {
  remote?: boolean;      // Flag for remote unpublishing
  force?: boolean;       // Force without prompting
  profile?: string;      // Profile for remote auth
  apiKey?: string;       // API key for remote auth
}

export interface UnpublishData {
  packageName: string;
  version?: string;          // undefined = all versions removed
  path: string;              // Registry path removed
  versionsRemoved: number;   // Count of versions removed (1 or multiple)
  fileCount: number;         // Total files removed
  remainingVersions: string[]; // Versions still in registry (empty if all removed)
}

export type UnpublishResult<T = UnpublishData> = CommandResult<T>;
