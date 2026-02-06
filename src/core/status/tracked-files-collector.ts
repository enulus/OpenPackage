/**
 * Tracked Files Collector
 * 
 * Extracts and organizes tracked files from the workspace index.
 */

import { join } from 'path';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { exists } from '../../utils/fs.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { normalizePlatforms } from '../../utils/platform-mapper.js';

/**
 * Represents a tracked file with its metadata
 */
export interface TrackedFile {
  /** Path in workspace (target) */
  workspacePath: string;
  /** Path in package (source) */
  sourcePath: string;
  /** Package that owns this file */
  packageName: string;
  /** Package version */
  packageVersion?: string;
  /** Inferred platform */
  platform?: string;
  /** Whether file exists on disk */
  exists: boolean;
}

/**
 * Result of collecting tracked files
 */
export interface TrackedFilesResult {
  /** All tracked files */
  files: TrackedFile[];
  /** Files grouped by platform */
  platformGroups: Map<string, TrackedFile[]>;
  /** Total count */
  totalFiles: number;
  /** Count of existing files */
  existingFiles: number;
  /** Count of missing files */
  missingFiles: number;
}

/**
 * Collect all tracked files from workspace index
 * 
 * @param targetDir - Workspace root directory
 * @param platformFilter - Optional array of platform names to filter by
 * @returns Tracked files with existence validation
 */
export async function collectTrackedFiles(
  targetDir: string,
  platformFilter?: string[]
): Promise<TrackedFilesResult> {
  const { index } = await readWorkspaceIndex(targetDir);
  const files: TrackedFile[] = [];

  // Normalize platform filter for case-insensitive comparison
  const normalizedFilter = normalizePlatforms(platformFilter);

  // Extract files from all packages
  for (const [packageName, packageData] of Object.entries(index.packages)) {
    const filesMapping = packageData.files || {};
    
    for (const [sourcePath, targets] of Object.entries(filesMapping)) {
      if (!Array.isArray(targets)) continue;
      
      for (const target of targets) {
        // Handle both string and object mappings
        const targetPath = typeof target === 'string' ? target : target.target;
        
        // Create absolute path for existence check
        const absolutePath = join(targetDir, targetPath);
        const fileExists = await exists(absolutePath);
        
        // Infer platform from workspace path
        const platform = inferPlatform(targetPath);
        
        // Apply platform filter if specified
        if (normalizedFilter && normalizedFilter.length > 0) {
          const platformLower = platform?.toLowerCase();
          if (!platformLower || !normalizedFilter.includes(platformLower)) {
            continue; // Skip this file if it doesn't match the filter
          }
        }
        
        files.push({
          workspacePath: normalizePathForProcessing(targetPath),
          sourcePath: normalizePathForProcessing(sourcePath),
          packageName,
          packageVersion: packageData.version,
          platform,
          exists: fileExists
        });
      }
    }
  }

  // Sort by workspace path
  files.sort((a, b) => a.workspacePath.localeCompare(b.workspacePath));

  // Group by platform
  const platformGroups = groupByPlatform(files);

  // Calculate counts
  const existingFiles = files.filter(f => f.exists).length;
  const missingFiles = files.filter(f => !f.exists).length;

  return {
    files,
    platformGroups,
    totalFiles: files.length,
    existingFiles,
    missingFiles
  };
}

/**
 * Infer platform from workspace path
 */
function inferPlatform(path: string): string | undefined {
  const normalized = normalizePathForProcessing(path);
  
  if (normalized.startsWith('.claude/')) return 'claude';
  if (normalized.startsWith('.cursor/')) return 'cursor';
  if (normalized.startsWith('.opencode/') || normalized.startsWith('.config/opencode/')) return 'opencode';
  if (normalized.startsWith('.codex/')) return 'codex';
  if (normalized.startsWith('.windsurf/')) return 'windsurf';
  if (normalized.startsWith('.augment/')) return 'augment';
  if (normalized.startsWith('.factory/')) return 'factory';
  if (normalized.startsWith('.kilocode/')) return 'kilocode';
  if (normalized.startsWith('.kiro/')) return 'kiro';
  if (normalized.startsWith('.pi/')) return 'pimono';
  if (normalized.startsWith('.qwen/')) return 'qwen';
  if (normalized.startsWith('.roo/')) return 'roo';
  if (normalized.startsWith('.agent/')) return 'antigravity';
  
  // Check for root-level platform files
  if (normalized === 'CLAUDE.md' || normalized === 'AGENTS.md') return 'claude';
  if (normalized === 'QWEN.md') return 'qwen';
  if (normalized === 'WARP.md') return 'warp';
  
  return 'other';
}

/**
 * Group files by platform
 */
function groupByPlatform(files: TrackedFile[]): Map<string, TrackedFile[]> {
  const groups = new Map<string, TrackedFile[]>();
  
  for (const file of files) {
    const platform = file.platform || 'other';
    if (!groups.has(platform)) {
      groups.set(platform, []);
    }
    groups.get(platform)!.push(file);
  }
  
  // Sort files within each group
  for (const group of groups.values()) {
    group.sort((a, b) => a.workspacePath.localeCompare(b.workspacePath));
  }
  
  return groups;
}
