/**
 * Unified Root File Operations
 * Handles root file installation and synchronization for both install and apply commands
 */

import { join } from 'path';
import { exists, readTextFile, writeTextFile } from '../../../utils/fs.js';
import { mergePackageContentIntoRootFile } from '../../../utils/root-file-merger.js';
import { extractPackageContentFromRootFile } from '../../../utils/root-file-extractor.js';
import { getPlatformDefinition, getAllPlatforms, type Platform } from '../../platforms.js';
import { FILE_PATTERNS } from '../../../constants/index.js';
import { logger } from '../../../utils/logger.js';
import { getPathLeaf } from '../../../utils/path-normalization.js';
import type { PackageFile } from '../../../types/index.js';

/**
 * Input for root file operations - supports both formats
 */
export type RootFileInput = 
  | Map<string, string>           // From install flow
  | PackageFile[]                 // From apply flow
  | Record<string, string>;       // Alternative map format

/**
 * Result of root file operations
 */
export interface RootFileOperationResult {
  /** Files that were newly created */
  created: string[];
  
  /** Files that were updated (already existed) */
  updated: string[];
  
  /** Files that were skipped (no changes needed) */
  skipped: string[];
  
  /** Legacy alias for created (for backward compatibility) */
  installed?: string[];
}

/**
 * Universal root file installer/syncer
 * 
 * Handles root file installation and synchronization for both install and apply commands.
 * Supports multiple input formats for maximum flexibility.
 * 
 * @param cwd - Current working directory
 * @param packageName - Name of the package
 * @param rootFiles - Root files to install (Map, PackageFile[], or Record)
 * @param platforms - Target platforms
 * @returns Operation result with created/updated/skipped files
 */
export async function installOrSyncRootFiles(
  cwd: string,
  packageName: string,
  rootFiles: RootFileInput,
  platforms: Platform[]
): Promise<RootFileOperationResult> {
  const result: RootFileOperationResult = {
    created: [],
    updated: [],
    skipped: []
  };
  
  // Normalize input to a common format
  const rootFilesMap = normalizeRootFileInput(rootFiles);
  
  if (rootFilesMap.size === 0) {
    return result;
  }
  
  // Always install/sync universal AGENTS.md regardless of platform detection
  await installUniversalAgentsFile(cwd, packageName, rootFilesMap, result);
  
  // Install platform-specific root files
  if (platforms.length > 0) {
    await installPlatformRootFiles(cwd, packageName, rootFilesMap, platforms, result);
  }
  
  // Deduplicate results
  result.created = Array.from(new Set(result.created));
  result.updated = Array.from(new Set(result.updated));
  result.skipped = Array.from(new Set(result.skipped));
  
  // Add legacy alias for backward compatibility
  result.installed = result.created;
  
  return result;
}

/**
 * Normalize different input formats to a common Map structure
 */
function normalizeRootFileInput(input: RootFileInput): Map<string, string> {
  // Already a Map
  if (input instanceof Map) {
    return input;
  }
  
  // PackageFile array
  if (Array.isArray(input)) {
    const map = new Map<string, string>();
    for (const file of input) {
      const fileName = getPathLeaf(file.path);
      if (fileName && isRootFile(fileName)) {
        map.set(fileName, file.content);
      }
    }
    return map;
  }
  
  // Plain object/Record
  return new Map(Object.entries(input));
}

/**
 * Check if a file name is a root file
 */
function isRootFile(fileName: string): boolean {
  const rootFileNames = new Set<string>([FILE_PATTERNS.AGENTS_MD]);
  
  // Add all platform root files
  for (const platform of getAllPlatforms()) {
    const def = getPlatformDefinition(platform);
    if (def.rootFile) {
      rootFileNames.add(def.rootFile);
    }
  }
  
  return rootFileNames.has(fileName);
}

/**
 * Install universal AGENTS.md file
 */
async function installUniversalAgentsFile(
  cwd: string,
  packageName: string,
  rootFilesMap: Map<string, string>,
  result: RootFileOperationResult
): Promise<void> {
  const agentsContent = rootFilesMap.get(FILE_PATTERNS.AGENTS_MD);
  
  if (!agentsContent || !agentsContent.trim()) {
    return;
  }
  
  try {
    const targetPath = join(cwd, FILE_PATTERNS.AGENTS_MD);
    const wasUpdated = await installSingleRootFile(
      targetPath,
      packageName,
      agentsContent.trim()
    );
    
    if (wasUpdated) {
      result.updated.push(FILE_PATTERNS.AGENTS_MD);
    } else {
      result.created.push(FILE_PATTERNS.AGENTS_MD);
    }
  } catch (error) {
    logger.error(`Failed to install universal root file ${FILE_PATTERNS.AGENTS_MD}: ${error}`);
    result.skipped.push(FILE_PATTERNS.AGENTS_MD);
  }
}

/**
 * Install platform-specific root files
 */
async function installPlatformRootFiles(
  cwd: string,
  packageName: string,
  rootFilesMap: Map<string, string>,
  platforms: Platform[],
  result: RootFileOperationResult
): Promise<void> {
  for (const platform of platforms) {
    const platformDef = getPlatformDefinition(platform);
    
    if (!platformDef.rootFile) {
      continue; // Platform doesn't use root files
    }
    
    // Skip if already handled by universal AGENTS.md
    if (platformDef.rootFile === FILE_PATTERNS.AGENTS_MD) {
      continue;
    }
    
    // Prefer platform-specific file, fallback to AGENTS.md
    let content = rootFilesMap.get(platformDef.rootFile);
    let sourceFileName = platformDef.rootFile;
    
    if (!content && rootFilesMap.has(FILE_PATTERNS.AGENTS_MD)) {
      content = rootFilesMap.get(FILE_PATTERNS.AGENTS_MD)!;
      sourceFileName = FILE_PATTERNS.AGENTS_MD;
    }
    
    if (!content || !content.trim()) {
      continue;
    }
    
    try {
      const targetPath = join(cwd, platformDef.rootFile);
      const wasUpdated = await installSingleRootFile(
        targetPath,
        packageName,
        content.trim()
      );
      
      if (wasUpdated) {
        result.updated.push(platformDef.rootFile);
      } else {
        result.created.push(platformDef.rootFile);
      }
    } catch (error) {
      logger.error(`Failed to install root file ${platformDef.rootFile}: ${error}`);
      result.skipped.push(platformDef.rootFile);
    }
  }
}

/**
 * Install or update a single root file
 * @returns true if file was updated (existed before), false if newly created
 */
async function installSingleRootFile(
  targetPath: string,
  packageName: string,
  sectionBody: string
): Promise<boolean> {
  // Read existing content if file exists
  let existingContent = '';
  let fileExists = false;
  
  if (await exists(targetPath)) {
    existingContent = await readTextFile(targetPath);
    fileExists = true;
  }
  
  // Check if section content is unchanged (optimization)
  if (fileExists) {
    const existingSectionContent = extractPackageContentFromRootFile(
      existingContent,
      packageName
    )?.trim();
    
    if (existingSectionContent === sectionBody) {
      return true; // Still counts as "updated" (touched but unchanged)
    }
  }
  
  // Merge package content into the file
  const mergedContent = mergePackageContentIntoRootFile(
    existingContent,
    packageName,
    sectionBody
  );
  
  // Write the merged content
  await writeTextFile(targetPath, mergedContent);
  
  return fileExists;
}
