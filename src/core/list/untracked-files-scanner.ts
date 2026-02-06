/**
 * Untracked Files Scanner
 * 
 * Discovers files in workspace that match platform patterns but are not tracked
 * in the workspace index (.openpackage/openpackage.index.yml).
 */

import { join, relative } from 'path';
import type { Platform } from '../platforms.js';
import { getDetectedPlatforms, getPlatformDefinition } from '../platforms.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { matchPattern } from '../flows/flow-source-discovery.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { normalizePlatforms } from '../../utils/platform-mapper.js';
import { logger } from '../../utils/logger.js';
import type { Flow, SwitchExpression } from '../../types/flows.js';

/**
 * Represents a file discovered in the workspace but not tracked in the index
 */
export interface UntrackedFile {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to workspace root */
  workspacePath: string;
  /** Platform that detected this file */
  platform: Platform;
  /** Flow pattern that matched this file */
  flowPattern: string;
  /** Category derived from pattern (rules, commands, agents, etc.) */
  category: string;
}

/**
 * Result of scanning for untracked files
 */
export interface UntrackedScanResult {
  /** All untracked files discovered */
  files: UntrackedFile[];
  /** Files grouped by platform */
  platformGroups: Map<Platform, UntrackedFile[]>;
  /** Files grouped by category */
  categoryGroups: Map<string, UntrackedFile[]>;
  /** Total count of untracked files */
  totalFiles: number;
}

/**
 * Pattern info extracted from a flow
 */
interface PatternInfo {
  pattern: string;
  platform: Platform;
  flow: Flow;
  category: string;
}

/**
 * Scan workspace for files that match platform patterns but are not tracked in index
 * 
 * @param workspaceRoot - Root directory of the workspace
 * @param platformFilter - Optional array of platform names to filter by
 * @returns Scan result with all untracked files
 */
export async function scanUntrackedFiles(
  workspaceRoot: string,
  platformFilter?: string[]
): Promise<UntrackedScanResult> {
  logger.debug('Starting untracked files scan', { workspaceRoot, platformFilter });

  // Step 1: Detect platforms in workspace
  let platforms = await getDetectedPlatforms(workspaceRoot);
  
  // Apply platform filter if specified
  const normalizedFilter = normalizePlatforms(platformFilter);
  if (normalizedFilter && normalizedFilter.length > 0) {
    platforms = platforms.filter(p => normalizedFilter.includes(p.toLowerCase()));
    logger.debug(`Filtered to platforms: ${platforms.join(', ') || 'none'}`);
  } else {
    logger.debug(`Detected platforms: ${platforms.join(', ') || 'none'}`);
  }
  
  if (platforms.length === 0) {
    logger.debug('No platforms detected in workspace');
    return createEmptyResult();
  }

  // Step 2: Extract patterns from platform flows
  const patterns = extractPatternsFromPlatforms(platforms, workspaceRoot);
  logger.debug(`Extracted ${patterns.length} patterns from ${platforms.length} platforms`);

  // Step 3: Discover files matching patterns
  const discoveredFiles = await discoverFilesFromPatterns(patterns, workspaceRoot);
  logger.debug(`Discovered ${discoveredFiles.size} unique files from patterns`);

  // Step 4: Load tracked files from workspace index
  const trackedPaths = await loadTrackedFilePaths(workspaceRoot);
  logger.debug(`Loaded ${trackedPaths.size} tracked files from index`);

  // Step 5: Filter to untracked files only
  const untrackedFiles = filterUntrackedFiles(discoveredFiles, trackedPaths);
  logger.debug(`Filtered to ${untrackedFiles.length} untracked files`);

  // Step 6: Group results
  return groupUntrackedFiles(untrackedFiles);
}

/**
 * Extract patterns from all platform export flows
 * Export flows represent package → workspace direction (the 'to' field is workspace location)
 */
function extractPatternsFromPlatforms(
  platforms: Platform[],
  workspaceRoot: string
): PatternInfo[] {
  const patterns: PatternInfo[] = [];

  for (const platform of platforms) {
    const definition = getPlatformDefinition(platform, workspaceRoot);
    
    // Process export flows (these define workspace file locations)
    for (const flow of definition.export) {
      const patternStrings = extractToPatterns(flow);
      
      for (const pattern of patternStrings) {
        const category = extractCategoryFromPattern(pattern);
        patterns.push({
          pattern,
          platform,
          flow,
          category
        });
      }
    }
  }

  return patterns;
}

/**
 * Extract 'to' patterns from a flow (handling switch expressions)
 */
function extractToPatterns(flow: Flow): string[] {
  const toField = flow.to;

  // Handle switch expressions - extract all possible patterns
  if (typeof toField === 'object' && '$switch' in toField) {
    const switchExpr = toField as SwitchExpression;
    const patterns: string[] = [];
    
    // Extract from cases
    if (switchExpr.$switch.cases) {
      for (const caseItem of switchExpr.$switch.cases) {
        if (typeof caseItem.value === 'string') {
          patterns.push(caseItem.value);
        }
      }
    }
    
    // Extract from default
    if (switchExpr.$switch.default && typeof switchExpr.$switch.default === 'string') {
      patterns.push(switchExpr.$switch.default);
    }
    
    return patterns;
  }

  // Handle string pattern
  if (typeof toField === 'string') {
    return [toField];
  }

  // Handle array patterns
  if (Array.isArray(toField)) {
    return toField.filter((p): p is string => typeof p === 'string');
  }

  return [];
}

/**
 * Extract category from pattern (e.g., "rules", "commands", "agents")
 */
function extractCategoryFromPattern(pattern: string): string {
  // Remove leading dot and platform root dir (e.g., ".claude/rules/..." -> "rules")
  const normalized = pattern.replace(/^\.[^/]+\//, '');
  
  // Extract first directory component
  const parts = normalized.split('/');
  if (parts.length > 1) {
    return parts[0];
  }
  
  // For root-level files, use "config" or filename without extension
  if (pattern.includes('.')) {
    const filename = pattern.split('/').pop() || pattern;
    const baseName = filename.replace(/^\.[^.]*\./, '').split('.')[0];
    return baseName || 'config';
  }
  
  return 'other';
}

/**
 * Discover files matching all patterns
 * Returns Map of absolute path -> UntrackedFile info
 */
async function discoverFilesFromPatterns(
  patterns: PatternInfo[],
  workspaceRoot: string
): Promise<Map<string, UntrackedFile>> {
  const filesMap = new Map<string, UntrackedFile>();
  const { minimatch } = await import('minimatch');
  const fs = await import('fs/promises');

  for (const patternInfo of patterns) {
    try {
      const matchedPaths = await matchFilesInWorkspace(patternInfo.pattern, workspaceRoot, fs);
      
      for (const relativePath of matchedPaths) {
        const absolutePath = join(workspaceRoot, relativePath);
        const normalizedPath = normalizePathForProcessing(absolutePath);
        
        // Store first match (don't override with later patterns)
        if (!filesMap.has(normalizedPath)) {
          filesMap.set(normalizedPath, {
            absolutePath: normalizedPath,
            workspacePath: normalizePathForProcessing(relativePath),
            platform: patternInfo.platform,
            flowPattern: patternInfo.pattern,
            category: patternInfo.category
          });
        }
      }
    } catch (error) {
      logger.debug(`Error matching pattern ${patternInfo.pattern}`, { error });
    }
  }

  return filesMap;
}

/**
 * Simple workspace file matcher
 */
async function matchFilesInWorkspace(
  pattern: string,
  workspaceRoot: string,
  fs: any
): Promise<string[]> {
  const { minimatch } = await import('minimatch');
  const matches: string[] = [];
  
  // Recursively walk directory
  async function walk(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const entryFull = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip .openpackage and node_modules
          if (entry.name === '.openpackage' || entry.name === 'node_modules' || entry.name === '.git') {
            continue;
          }
          await walk(entryFull, entryRelative);
        } else if (entry.isFile()) {
          // Check if file matches pattern
          if (minimatch(entryRelative, pattern, { dot: true })) {
            matches.push(entryRelative);
          }
        }
      }
    } catch (error) {
      // Ignore permission errors
    }
  }
  
  await walk(workspaceRoot);
  return matches;
}

/**
 * Load all tracked file paths from workspace index
 * Returns Set of normalized absolute paths
 */
async function loadTrackedFilePaths(workspaceRoot: string): Promise<Set<string>> {
  const trackedPaths = new Set<string>();

  try {
    const { index } = await readWorkspaceIndex(workspaceRoot);
    
    // Extract all target paths from all packages
    for (const [packageName, packageData] of Object.entries(index.packages)) {
      const filesMapping = packageData.files || {};
      
      for (const [sourceKey, targets] of Object.entries(filesMapping)) {
        if (!Array.isArray(targets)) continue;
        
        for (const target of targets) {
          // Handle both string and object mappings
          const targetPath = typeof target === 'string' ? target : target.target;
          
          // Resolve target path to absolute
          const resolved = resolveDeclaredPath(targetPath, workspaceRoot);
          const normalized = normalizePathForProcessing(resolved.absolute);
          trackedPaths.add(normalized);
        }
      }
    }
  } catch (error) {
    logger.debug('Failed to load workspace index', { error });
  }

  return trackedPaths;
}

/**
 * Filter discovered files to only untracked ones
 */
function filterUntrackedFiles(
  discoveredFiles: Map<string, UntrackedFile>,
  trackedPaths: Set<string>
): UntrackedFile[] {
  const untracked: UntrackedFile[] = [];

  for (const [absolutePath, fileInfo] of discoveredFiles) {
    const normalized = normalizePathForProcessing(absolutePath);
    
    if (!trackedPaths.has(normalized)) {
      untracked.push(fileInfo);
    }
  }

  // Sort by workspace path for consistent output
  return untracked.sort((a, b) => a.workspacePath.localeCompare(b.workspacePath));
}

/**
 * Group untracked files by platform and category
 */
function groupUntrackedFiles(files: UntrackedFile[]): UntrackedScanResult {
  const platformGroups = new Map<Platform, UntrackedFile[]>();
  const categoryGroups = new Map<string, UntrackedFile[]>();

  for (const file of files) {
    // Group by platform
    if (!platformGroups.has(file.platform)) {
      platformGroups.set(file.platform, []);
    }
    platformGroups.get(file.platform)!.push(file);

    // Group by category
    if (!categoryGroups.has(file.category)) {
      categoryGroups.set(file.category, []);
    }
    categoryGroups.get(file.category)!.push(file);
  }

  return {
    files,
    platformGroups,
    categoryGroups,
    totalFiles: files.length
  };
}

/**
 * Create an empty result
 */
function createEmptyResult(): UntrackedScanResult {
  return {
    files: [],
    platformGroups: new Map(),
    categoryGroups: new Map(),
    totalFiles: 0
  };
}
