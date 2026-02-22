/**
 * Shared platform types extracted from core/platforms.ts
 * Both core/ and utils/ can import from here without circular dependencies.
 */

import type { Flow } from './flows.js';

export type Platform = string;

export interface PlatformDefinition {
  id: Platform;
  name: string;
  rootDir?: string;
  rootFile?: string;
  detection?: string[];
  export: Flow[];
  import: Flow[];
  aliases?: string[];
  enabled: boolean;
  description?: string;
  variables?: Record<string, any>;
}

export interface PlatformDetectionResult {
  name: Platform;
  detected: boolean;
}

export type PlatformPaths = {
  rootDir: string;
  rootFile?: string;
  subdirs: Record<string, string>;
};

export interface PlatformDirectoryPaths {
  [platformName: string]: PlatformPaths;
}
