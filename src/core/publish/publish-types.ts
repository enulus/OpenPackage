import type { CommandResult } from '../../types/index.js';

export interface PublishOptions {
  profile?: string;
  apiKey?: string;
  local?: boolean;   // Flag for local publishing
  force?: boolean;   // Force overwrite without prompting
}

export interface PublishData {
  packageName: string;
  version?: string;
  size: number;
  checksum: string;
  registry: string;
  profile: string;
  message?: string;
}

export type PublishResult<T = PublishData> = CommandResult<T>;
