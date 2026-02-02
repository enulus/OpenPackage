/**
 * Flow-Based Index Installer
 * 
 * INFRASTRUCTURE LAYER: Workspace index integration
 * 
 * Wraps flow-based-installer.ts with workspace index management.
 * This is the primary entry point for production installations.
 * 
 * Delegates to flow-based-installer.ts for core flow execution,
 * then updates workspace index with file mappings.
 * 
 * Hierarchy:
 *   Command Layer → install-flow.ts → THIS FILE → flow-based-installer.ts
 */

import { join } from 'path';
import { promises as fs } from 'fs';
import {
  installPackageWithFlows,
  type FlowInstallContext
} from '../core/install/flow-based-installer.js';
import { resolvePackageContentRoot } from '../core/install/local-source-resolution.js';
import { logger } from './logger.js';
import { formatPathForYaml } from './path-resolution.js';
import { sortMapping } from './package-index-yml.js';
import {
  readWorkspaceIndex,
  writeWorkspaceIndex
} from './workspace-index-yml.js';
import { exists } from './fs.js';
import type { Platform } from '../core/platforms.js';
import type { InstallOptions } from '../types/index.js';
import type { WorkspaceIndexFileMapping } from '../types/workspace-index.js';
import { createContextFromFormat } from '../core/conversion-context/creation.js';
import { detectFormatWithContextFromDirectory } from '../core/install/helpers/format-detection.js';
import {
  logConflictMessages,
  logErrorMessages
} from '../core/install/helpers/result-logging.js';
import {
  collectConflictMessages,
  collectErrorMessages
} from '../core/install/helpers/result-aggregation.js';

// ============================================================================
// Types
// ============================================================================

export interface IndexInstallResult {
  installed: number;
  updated: number;
  deleted: number;
  skipped: number;
  files: string[];
  installedFiles: string[];
  updatedFiles: string[];
  deletedFiles: string[];
}

interface PackageIndexRecord {
  path: string;
  packageName: string;
  workspace: {
    version: string;
    hash?: string;
  };
  files: Record<string, (string | WorkspaceIndexFileMapping)[]>;
}

// ============================================================================
// Main Installation Function
// ============================================================================

/**
 * Install a package using flow-based installation
 * This is the new entry point that replaces installPackageByIndex
 */
export async function installPackageByIndexWithFlows(
  cwd: string,
  packageName: string,
  version: string,
  platforms: Platform[],
  options: InstallOptions,
  includePaths?: string[],
  contentRoot?: string,
  packageFormat?: any,  // Optional format metadata from plugin transformer
  marketplaceMetadata?: {  // Optional marketplace source metadata
    url: string;
    commitSha: string;
    pluginName: string;
  },
  matchedPattern?: string  // Phase 4: Pattern from base detection
): Promise<IndexInstallResult> {
  logger.debug(`Installing ${packageName}@${version} with flows for platforms: ${platforms.join(', ')}`);

  // Resolve package root
  const resolvedContentRoot = contentRoot ?? await resolvePackageContentRoot({ 
    cwd, 
    packageName, 
    version 
  });

  // Aggregate results across all platforms
  const aggregatedResult: IndexInstallResult = {
    installed: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    files: [],
    installedFiles: [],
    updatedFiles: [],
    deletedFiles: []
  };

  const allTargetPaths = new Set<string>();
  const allConflicts: string[] = [];
  const allErrors: string[] = [];
  const fileMapping: Record<string, (string | WorkspaceIndexFileMapping)[]> = {};
  
  // Helper to normalize source keys: merge variants that refer to the same file
  // This handles cases where .mcp.json and mcp.jsonc are discovered separately but refer to the same file
  const sourceKeyCache = new Map<string, string>(); // Maps discovered source -> canonical key
  const normalizeSourceKey = async (source: string): Promise<string> => {
    // Check cache first
    if (sourceKeyCache.has(source)) {
      return sourceKeyCache.get(source)!;
    }
    
    const sourceAbs = join(resolvedContentRoot, source);
    if (!await exists(sourceAbs)) {
      sourceKeyCache.set(source, source);
      return source;
    }
    
    // Check if any already-seen source key refers to the same file
    // When both .mcp.json and mcp.jsonc exist and refer to the same file, prefer .mcp.json
    // (since apply command uses .mcp.json, it's the canonical form)
    let canonicalKey = source;
    for (const [cachedSource, cachedCanonical] of sourceKeyCache.entries()) {
      if (cachedSource === source) continue;
      const cachedAbs = join(resolvedContentRoot, cachedSource);
      if (await exists(cachedAbs)) {
        try {
          const sourceStat = await fs.stat(sourceAbs);
          const cachedStat = await fs.stat(cachedAbs);
          // Same file if same inode (Unix) or same size+mtime
          if (sourceStat.ino === cachedStat.ino || 
              (sourceStat.size === cachedStat.size && 
               Math.abs(sourceStat.mtimeMs - cachedStat.mtimeMs) < 1000)) {
            // Prefer dot-prefixed variant (.mcp.json) as canonical key when both exist
            // This matches apply command behavior
            if (source.startsWith('.') && !cachedCanonical.startsWith('.')) {
              canonicalKey = source;
              // Update cached entry to use dot-prefixed variant
              sourceKeyCache.set(cachedSource, source);
            } else if (!source.startsWith('.') && cachedCanonical.startsWith('.')) {
              canonicalKey = cachedCanonical;
            } else {
              canonicalKey = cachedCanonical;
            }
            sourceKeyCache.set(source, canonicalKey);
            return canonicalKey;
          }
        } catch {
          // If stat fails, treat as different files
        }
      }
    }
    
    // No match found, use source as canonical key
    sourceKeyCache.set(source, source);
    return source;
  };

  // Execute flows for each platform
  for (const platform of platforms) {
    // Create conversion context from format or detect it using shared utility
    let conversionContext;
    let format = packageFormat;
    
    if (!packageFormat) {
      // Detect format and context from directory
      const result = await detectFormatWithContextFromDirectory(resolvedContentRoot);
      format = result.format;
      conversionContext = result.context;
    } else {
      // Create context from existing format
      conversionContext = createContextFromFormat(packageFormat);
    }
    
    const installContext: FlowInstallContext = {
      packageName,
      packageRoot: resolvedContentRoot,
      workspaceRoot: cwd,
      platform,
      packageVersion: version,
      priority: 0, // Priority is calculated from dependency graph during multi-package installs
      dryRun: options.dryRun ?? false,
      packageFormat: format,
      conversionContext,
      // Phase 4: Pass resource filtering info
      matchedPattern,
      resourceFilter: includePaths
    };

    try {
      const result = await installPackageWithFlows(installContext, options);

      // Aggregate target paths + per-source mapping for workspace index
      for (const absTarget of result.targetPaths ?? []) {
        allTargetPaths.add(absTarget);
      }
      // Merge file mappings with normalization
      for (const [source, targets] of Object.entries(result.fileMapping ?? {})) {
        const normalizedSource = await normalizeSourceKey(source);
        
        if (!fileMapping[normalizedSource]) {
          fileMapping[normalizedSource] = [];
        }
        
        // Note: mergeWorkspaceFileMappings expects nested objects, so we wrap in object
        const tempTarget = { [normalizedSource]: fileMapping[normalizedSource] };
        const tempSource = { [normalizedSource]: targets };
        
        // Merge while deduping by target path; prefer complex mapping over string
        const byTarget = new Map<string, string | WorkspaceIndexFileMapping>();
        for (const m of fileMapping[normalizedSource]) {
          const targetPath = typeof m === 'string' ? m : m.target;
          byTarget.set(targetPath, m);
        }
        for (const m of targets) {
          const targetPath = typeof m === 'string' ? m : m.target;
          const prior = byTarget.get(targetPath);
          if (!prior) {
            byTarget.set(targetPath, m);
          } else if (typeof prior === 'string' && typeof m !== 'string') {
            byTarget.set(targetPath, m);
          }
        }
        fileMapping[normalizedSource] = Array.from(byTarget.values());
      }

      // Aggregate statistics
      aggregatedResult.installed += result.filesProcessed;
      aggregatedResult.updated += 0; // Flow executor doesn't distinguish new vs updated yet
      aggregatedResult.skipped += result.filesProcessed - result.filesWritten;

      // Collect conflicts and errors using shared utilities
      collectConflictMessages(allConflicts, result.conflicts);
      collectErrorMessages(allErrors, result.errors);

      // Log results per platform
      if (result.filesProcessed > 0) {
        logger.info(
          `${platform}: processed ${result.filesProcessed} files` +
          (options.dryRun ? ' (dry run)' : `, wrote ${result.filesWritten} files`)
        );
      }

    } catch (error) {
      logger.error(`Failed to install ${packageName} for platform ${platform}: ${error}`);
      allErrors.push(`${platform}: ${error}`);
    }
  }

  // Log aggregated results using shared utilities
  logConflictMessages(allConflicts);
  logErrorMessages(allErrors);

  // Update workspace index if not dry-run
  if (!options.dryRun) {
    await updateWorkspaceIndexForFlows(
      cwd,
      packageName,
      version,
      resolvedContentRoot,
      fileMapping,
      marketplaceMetadata
    );
  }

  // Set result files
  aggregatedResult.files = Array.from(allTargetPaths);
  aggregatedResult.installedFiles = Array.from(allTargetPaths);

  return aggregatedResult;
}

// ============================================================================
// Workspace Index Management
// ============================================================================

/**
 * Update workspace index with flow-based installation results
 */
async function updateWorkspaceIndexForFlows(
  cwd: string,
  packageName: string,
  version: string,
  packagePath: string,
  fileMapping: Record<string, (string | WorkspaceIndexFileMapping)[]>,
  marketplaceMetadata?: {
    url: string;
    commitSha: string;
    pluginName: string;
  }
): Promise<void> {
  try {
    const wsRecord = await readWorkspaceIndex(cwd);
    
    // Initialize packages map if needed
    wsRecord.index.packages = wsRecord.index.packages ?? {};
    
    // Convert file mapping to workspace index format
    const files: Record<string, (string | WorkspaceIndexFileMapping)[]> = {};
    for (const [source, targets] of Object.entries(fileMapping)) {
      files[source] = targets;
    }
    
    // Convert to workspace-relative path if under workspace, then apply tilde notation for global paths
    const formattedPath = formatPathForYaml(packagePath, cwd);
    
    // Update package entry
    const packageEntry: any = {
      ...wsRecord.index.packages[packageName],
      path: formattedPath,
      version,
      files: sortMapping(files)
    };
    
    // Add marketplace metadata if present
    if (marketplaceMetadata) {
      packageEntry.marketplace = marketplaceMetadata;
    }
    
    wsRecord.index.packages[packageName] = packageEntry;
    
    await writeWorkspaceIndex(wsRecord);
    logger.debug(`Updated workspace index for ${packageName}@${version}`);
  } catch (error) {
    logger.warn(`Failed to update workspace index for ${packageName}: ${error}`);
  }
}


// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Read package index from workspace
 */
async function readPackageIndex(
  cwd: string,
  packageName: string
): Promise<PackageIndexRecord | null> {
  const record = await readWorkspaceIndex(cwd);
  const entry = record.index.packages?.[packageName];
  if (!entry) return null;
  
  return {
    path: entry.path ?? '',
    packageName,
    workspace: {
      version: entry.version ?? '',
      hash: undefined
    },
    files: entry.files ?? {}
  };
}

/**
 * Write package index to workspace
 */
async function writePackageIndex(
  record: PackageIndexRecord,
  cwd: string
): Promise<void> {
  const wsRecord = await readWorkspaceIndex(cwd);
  wsRecord.index.packages = wsRecord.index.packages ?? {};
  
  const entry = wsRecord.index.packages[record.packageName];
  const rawPath = entry?.path ?? record.path ?? '';
  
  if (!rawPath) {
    logger.warn(
      `Skipping workspace index write for ${record.packageName}: source path is unknown`
    );
    return;
  }
  
  // Convert to workspace-relative path if under workspace, then apply tilde notation for global paths
  const pathToUse = formatPathForYaml(rawPath, cwd);
  
  wsRecord.index.packages[record.packageName] = {
    ...entry,
    path: pathToUse,
    version: entry?.version ?? record.workspace?.version,
    files: sortMapping(record.files ?? {})
  };
  
  await writeWorkspaceIndex(wsRecord);
}
