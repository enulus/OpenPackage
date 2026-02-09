/**
 * Untracked Files Scanner
 * 
 * Discovers files in workspace that match platform patterns but are not tracked
 * in the workspace index (.openpackage/openpackage.index.yml).
 * 
 * Uses static-prefix extraction to determine minimal walk roots from patterns,
 * then delegates to fast-glob for efficient, bounded directory traversal.
 * This prevents unbounded walks when workspaceRoot is ~ (home directory).
 */

import { join } from 'path';
import { homedir } from 'os';
import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import type { Platform } from '../platforms.js';
import { getDetectedPlatforms, getPlatformDefinition } from '../platforms.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
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
      const patternStrings = extractToPatterns(flow, workspaceRoot);
      
      for (const pattern of patternStrings) {
        // Extract category from the 'from' field (universal format) instead of 'to'
        const category = extractCategoryFromFlow(flow);
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
 * Extract category from flow's 'from' pattern (universal format)
 * The 'from' field represents the universal resource type which is consistent
 * across all platforms, unlike the 'to' field which is platform-specific.
 */
function extractCategoryFromFlow(flow: Flow): string {
  const fromField = flow.from;
  
  // Handle string pattern
  let fromPattern: string;
  if (typeof fromField === 'string') {
    fromPattern = fromField;
  } else if (Array.isArray(fromField)) {
    // Use first pattern from array
    fromPattern = fromField[0] || '';
  } else if (typeof fromField === 'object' && '$switch' in fromField) {
    // For switch expressions, we can't determine the exact pattern without context
    // Fall back to extracting from all case patterns
    const switchExpr = fromField as SwitchExpression;
    
    // Try default first
    if (switchExpr.$switch.default) {
      if (typeof switchExpr.$switch.default === 'string') {
        fromPattern = switchExpr.$switch.default;
      } else if (typeof switchExpr.$switch.default === 'object' && 'pattern' in switchExpr.$switch.default) {
        fromPattern = switchExpr.$switch.default.pattern;
      } else {
        return 'other';
      }
    } else if (switchExpr.$switch.cases && switchExpr.$switch.cases.length > 0) {
      // Use first case as fallback
      const firstCase = switchExpr.$switch.cases[0].value;
      if (typeof firstCase === 'string') {
        fromPattern = firstCase;
      } else if (typeof firstCase === 'object' && 'pattern' in firstCase) {
        fromPattern = firstCase.pattern;
      } else {
        return 'other';
      }
    } else {
      return 'other';
    }
  } else if (typeof fromField === 'object' && 'pattern' in fromField) {
    // Handle object with pattern field (e.g., { pattern: "agents/**/*.md", schema: "..." })
    const patternObj = fromField as { pattern: string };
    fromPattern = patternObj.pattern;
  } else {
    return 'other';
  }
  
  // Extract first directory component from pattern
  // Examples:
  //   "skills/**/*" → "skills"
  //   "rules/**/*.md" → "rules"
  //   "commands/**/*.md" → "commands"
  //   "mcp.jsonc" → "mcps"
  //   "AGENTS.md" → "agents"
  const parts = fromPattern.split('/');
  const firstPart = parts[0];
  
  // Handle file-based resources
  if (firstPart.includes('.')) {
    // Special cases for known files
    if (firstPart === 'mcp.jsonc' || firstPart === 'mcp.json') {
      return 'mcps';
    }
    if (firstPart === 'AGENTS.md') {
      return 'agents';
    }
    if (firstPart === 'CLAUDE.md' || firstPart === 'QWEN.md' || firstPart === 'WARP.md') {
      return 'agents';
    }
    // For other files, extract base name
    const baseName = firstPart.replace(/\.[^.]+$/, '').toLowerCase();
    return baseName || 'other';
  }
  
  // For directory-based resources, return the directory name
  return firstPart || 'other';
}

/**
 * Extract 'to' patterns from a flow (handling switch expressions)
 * Resolves switch expressions based on workspaceRoot context
 */
function extractToPatterns(flow: Flow, workspaceRoot: string): string[] {
  const toField = flow.to;

  // Handle switch expressions - resolve based on workspaceRoot
  if (typeof toField === 'object' && '$switch' in toField) {
    const switchExpr = toField as SwitchExpression;
    const patterns: string[] = [];
    
    // Check if we're in global mode
    const normalizedRoot = workspaceRoot.replace(/\/+$/, '');
    const isGlobal = normalizedRoot === homedir();
    
    // Try to match a case first
    if (switchExpr.$switch.cases) {
      for (const caseItem of switchExpr.$switch.cases) {
        // Check if this case matches our context
        if (caseItem.pattern === '~/' && isGlobal) {
          // Extract the actual pattern value
          if (typeof caseItem.value === 'string') {
            return [caseItem.value];
          } else if (typeof caseItem.value === 'object' && 'pattern' in caseItem.value) {
            return [caseItem.value.pattern];
          }
        }
      }
    }
    
    // Fall back to default
    if (switchExpr.$switch.default) {
      if (typeof switchExpr.$switch.default === 'string') {
        return [switchExpr.$switch.default];
      } else if (typeof switchExpr.$switch.default === 'object' && 'pattern' in switchExpr.$switch.default) {
        return [switchExpr.$switch.default.pattern];
      }
    }
    
    // If no match, collect all possible patterns for safety
    if (switchExpr.$switch.cases) {
      for (const caseItem of switchExpr.$switch.cases) {
        if (typeof caseItem.value === 'string') {
          patterns.push(caseItem.value);
        } else if (typeof caseItem.value === 'object' && 'pattern' in caseItem.value) {
          patterns.push(caseItem.value.pattern);
        }
      }
    }
    
    return patterns;
  }

  // Handle object with pattern field
  if (typeof toField === 'object' && 'pattern' in toField && typeof toField.pattern === 'string') {
    return [toField.pattern];
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
 * Extract the static (non-glob) prefix directory from a pattern.
 * Consumes path segments until a segment containing glob metacharacters is found.
 * 
 * Examples:
 *   ".claude/rules/*.md"  -> { root: ".claude/rules", rootOnly: false }
 *   ".cursor/rules/*.md"  -> { root: ".cursor/rules", rootOnly: false }
 *   "AGENTS.md"           -> { root: null, rootOnly: true }
 *   "**\/*.md"             -> { root: null, rootOnly: false } (unsafe)
 */
export function extractStaticWalkRoot(pattern: string): { root: string | null; rootOnly: boolean } {
  const normalized = pattern.replace(/\\/g, '/');

  if (!normalized.includes('/')) {
    return { root: null, rootOnly: true };
  }

  const segments = normalized.split('/');
  const hasGlobMeta = (seg: string) => /[*?\[\]{}()!+@]/.test(seg);
  const staticSegments: string[] = [];

  for (const seg of segments) {
    if (!seg) continue;
    if (hasGlobMeta(seg)) break;
    staticSegments.push(seg);
  }

  if (staticSegments.length === 0) {
    return { root: null, rootOnly: false };
  }

  return { root: staticSegments.join('/'), rootOnly: false };
}

const IGNORED_DIRS = ['**/.openpackage/**', '**/node_modules/**', '**/.git/**'];

/**
 * Check if workspaceRoot is a "dangerous" unbounded directory (home or filesystem root)
 */
function isDangerousRoot(workspaceRoot: string): boolean {
  const normalized = workspaceRoot.replace(/\/+$/, '');
  return normalized === homedir() || normalized === '/' || normalized === '';
}

/**
 * Discover files matching all patterns using fast-glob with static-prefix scoping.
 * 
 * Strategy:
 * 1. Extract static walk roots from each pattern to avoid unbounded traversal
 * 2. Group patterns by walk root for efficient single-pass scanning
 * 3. Use fast-glob scoped to each walk root
 * 4. For root-only patterns (e.g. "AGENTS.md"), scan only immediate children
 * 5. Skip unsafe patterns (no static prefix) when workspaceRoot is ~ or /
 */
async function discoverFilesFromPatterns(
  patterns: PatternInfo[],
  workspaceRoot: string
): Promise<Map<string, UntrackedFile>> {
  const filesMap = new Map<string, UntrackedFile>();
  const dangerous = isDangerousRoot(workspaceRoot);

  const rootOnlyPatterns: PatternInfo[] = [];
  const unsafePatterns: PatternInfo[] = [];
  const rootedGroups = new Map<string, PatternInfo[]>();

  for (const patternInfo of patterns) {
    const { root, rootOnly } = extractStaticWalkRoot(patternInfo.pattern);

    if (rootOnly) {
      rootOnlyPatterns.push(patternInfo);
    } else if (root === null) {
      unsafePatterns.push(patternInfo);
    } else {
      if (!rootedGroups.has(root)) {
        rootedGroups.set(root, []);
      }
      rootedGroups.get(root)!.push(patternInfo);
    }
  }

  if (unsafePatterns.length > 0) {
    if (dangerous) {
      logger.debug(
        `Skipping ${unsafePatterns.length} unsafe patterns for dangerous root ${workspaceRoot}: ` +
        unsafePatterns.map(p => p.pattern).join(', ')
      );
    } else {
      rootedGroups.set('', unsafePatterns);
    }
  }

  if (rootOnlyPatterns.length > 0) {
    try {
      const rootLevelGlobs = rootOnlyPatterns.map(p => p.pattern);
      const matched = await fg(rootLevelGlobs, {
        cwd: workspaceRoot,
        dot: true,
        onlyFiles: true,
        deep: 1,
        ignore: IGNORED_DIRS,
      });

      for (const relativePath of matched) {
        addMatchToMap(filesMap, relativePath, rootOnlyPatterns, workspaceRoot);
      }
    } catch (error) {
      logger.debug('Error scanning root-only patterns', { error });
    }
  }

  for (const [root, groupPatterns] of rootedGroups) {
    try {
      const scopedGlobs = groupPatterns.map(p => {
        if (root && p.pattern.startsWith(root + '/')) {
          return p.pattern.slice(root.length + 1);
        }
        return p.pattern;
      });

      const matched = await fg(scopedGlobs, {
        cwd: root ? join(workspaceRoot, root) : workspaceRoot,
        dot: true,
        onlyFiles: true,
        ignore: IGNORED_DIRS,
      });

      for (const matchedRelative of matched) {
        const relativePath = root ? `${root}/${matchedRelative}` : matchedRelative;
        addMatchToMap(filesMap, relativePath, groupPatterns, workspaceRoot);
      }
    } catch (error) {
      logger.debug(`Error scanning rooted group "${root}"`, { error });
    }
  }

  return filesMap;
}

/**
 * Add a matched file path to the results map, attributing it to the first matching pattern
 */
function addMatchToMap(
  filesMap: Map<string, UntrackedFile>,
  relativePath: string,
  patterns: PatternInfo[],
  workspaceRoot: string
): void {
  const absolutePath = join(workspaceRoot, relativePath);
  const normalizedPath = normalizePathForProcessing(absolutePath);

  if (filesMap.has(normalizedPath)) return;

  const matchingPattern = patterns.find(p =>
    minimatch(relativePath, p.pattern, { dot: true })
  ) || patterns[0];

  filesMap.set(normalizedPath, {
    absolutePath: normalizedPath,
    workspacePath: normalizePathForProcessing(relativePath),
    platform: matchingPattern.platform,
    flowPattern: matchingPattern.pattern,
    category: matchingPattern.category,
  });
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
