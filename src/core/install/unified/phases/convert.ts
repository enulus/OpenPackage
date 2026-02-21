/**
 * Convert Phase
 * 
 * Performs format detection and pre-conversion of packages.
 * Integrates Phase 2 detection and Phase 3 conversion into the pipeline.
 * 
 * Phase 4: Integration with Existing Pipeline
 */

import type { InstallationContext } from '../context.js';
import { coordinateConversion } from '../../conversion-coordinator.js';
import { addWarning } from '../context-helpers.js';
import { logger } from '../../../../utils/logger.js';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { readFile } from 'fs/promises';
import type { PackageFile as DetectionPackageFile } from '../../detection-types.js';
import { minimatch } from 'minimatch';
import { getPlatformDefinitions, matchesUniversalPattern } from '../../../platforms.js';
import { getPatternFromFlow } from '../../schema-registry.js';
import { 
  createTempPackageDirectory, 
  writeTempPackageFiles,
  createConversionCacheDirectory,
  cleanupTempDirectory
} from '../../strategies/helpers/temp-directory.js';

/**
 * Convert phase - detect format and pre-convert if needed
 * 
 * This phase:
 * 1. Loads all files from content root
 * 2. Runs format detection (Tier 1 + Tier 2)
 * 3. Pre-converts if platform-specific format detected
 * 4. Updates context with conversion metadata
 * 
 * @param ctx - Installation context
 */
export async function convertPhase(ctx: InstallationContext): Promise<void> {
  // Skip if no content root (shouldn't happen after load phase)
  if (!ctx.source.contentRoot) {
    logger.warn('No content root, skipping convert phase');
    return;
  }
  
  // Skip if package is a marketplace (will be handled by marketplace flow)
  if (ctx.source.pluginMetadata?.pluginType === 'marketplace') {
    return;
  }
  
  try {
    // Load package files
    const files = await loadPackageFiles(ctx.source.contentRoot, {
      targetDir: ctx.targetDir,
      matchedPattern: ctx.matchedPattern
    });
    
    if (files.length === 0) {
      logger.warn('No files found in package, skipping conversion');
      return;
    }

    // Coordinate conversion (detection + conversion if needed)
    const conversionResult = await coordinateConversion(
      files,
      ctx.source.contentRoot,
      {
        targetDir: ctx.targetDir,
        skipConversion: false
      }
    );
    
    // Update context with conversion metadata
    ctx.formatDetection = conversionResult.formatDetection;
    ctx.wasPreConverted = conversionResult.wasConverted;
    
    if (conversionResult.errors.length > 0) {
      ctx.conversionErrors = conversionResult.errors;
      logger.warn('Conversion had errors', {
        errorCount: conversionResult.errors.length
      });
    }
    
    // Add warnings to context
    for (const warning of conversionResult.warnings) {
      addWarning(ctx, warning);
    }
    
    // Log conversion results
    if (conversionResult.wasConverted) {
      logger.info('Package pre-converted to universal format', {
        packageName: ctx.source.packageName,
        originalFormat: conversionResult.formatDetection.packageFormat,
        fileCount: conversionResult.files.length,
        detectionMethod: conversionResult.formatDetection.detectionMethod
      });

      // Store original contentRoot before any modifications
      const originalContentRoot = ctx.source.contentRoot;
      
      // Determine conversion strategy based on source location
      const isGitCache = originalContentRoot.includes('/.openpackage/cache/git/') || 
                         originalContentRoot.includes('.openpackage/cache/git/');
      
      let conversionRoot: string;
      let shouldCleanup = false;
      
      if (isGitCache) {
        // Git cache: Store converted files in .opkg-converted subdirectory
        // Extract the git cache root (without any subdirectory)
        const gitCacheMatch = originalContentRoot.match(/(.+\.openpackage\/cache\/git\/[^\/]+\/[^\/]+)/);
        const gitCacheRoot = gitCacheMatch ? gitCacheMatch[1] : originalContentRoot;
        
        const isResourceScoped = Boolean(ctx.matchedPattern);
        
        if (!isResourceScoped) {
          // Full install: wipe any existing conversion cache first.
          // A prior resource-scoped install (e.g. --agents code-reviewer) may have
          // populated the cache with only a subset of files. Stale files that no
          // longer exist in the source would survive a write-over and get installed.
          const existingCache = join(gitCacheRoot, '.opkg-converted');
          await cleanupTempDirectory(existingCache);
        }

        conversionRoot = await createConversionCacheDirectory(gitCacheRoot);
        await writeTempPackageFiles(conversionResult.files, conversionRoot);
        shouldCleanup = false;
        logger.info(isResourceScoped
          ? 'Patched conversion cache with resource-scoped files'
          : 'Created fresh conversion cache for full install', {
          conversionRoot,
          fileCount: conversionResult.files.length
        });
      } else {
        // Local path or other source: Use temporary directory
        conversionRoot = await createTempPackageDirectory('opkg-preconverted-');
        await writeTempPackageFiles(conversionResult.files, conversionRoot);
        shouldCleanup = true; // Cleanup temp directory after install
        logger.info('Created temporary conversion directory', { conversionRoot });
      }

      // Track temp dir for cleanup in the pipeline (only for non-git-cache)
      if (shouldCleanup) {
        (ctx as any)._tempConversionRoot = conversionRoot;
      }
      
      // Store original content root for index writing
      (ctx as any)._originalContentRoot = originalContentRoot;

      // Update content roots so installation uses converted files
      ctx.source.contentRoot = conversionRoot;
      const rootPkg = ctx.resolvedPackages.find((p: any) => p.isRoot);
      if (rootPkg) {
        rootPkg.contentRoot = conversionRoot;
        // Store original for index writing
        (rootPkg as any).originalContentRoot = originalContentRoot;
      }
      
      // Store converted files in package metadata for downstream use
      if (ctx.resolvedPackages.length > 0) {
        const rootPackage = ctx.resolvedPackages[0];
        if (rootPackage.pkg) {
          // Store converted files in package
          rootPackage.pkg.files = conversionResult.files;
          
          // Mark as converted in metadata
          if (!rootPackage.pkg.metadata) {
            rootPackage.pkg.metadata = {} as any;
          }
          (rootPackage.pkg.metadata as any)._wasConverted = true;
          (rootPackage.pkg.metadata as any)._originalFormat = conversionResult.formatDetection.packageFormat;
        }
      }
    }
    
  } catch (error) {
    // Conversion errors are non-fatal - log and continue
    logger.error('Convert phase failed', { error });
    addWarning(
      ctx,
      `Format conversion failed: ${error instanceof Error ? error.message : String(error)}`
    );
    
    // Store error in context
    if (!ctx.conversionErrors) {
      ctx.conversionErrors = [];
    }
    ctx.conversionErrors.push(
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Load all package files from content root
 * 
 * Recursively walks directory tree and loads all files.
 * 
 * @param contentRoot - Package content root path
 * @returns Array of package files with paths and content
 */
async function loadPackageFiles(
  contentRoot: string,
  opts: { targetDir: string; matchedPattern?: string }
): Promise<DetectionPackageFile[]> {
  const files: DetectionPackageFile[] = [];
  
  function isRelevantPath(relPath: string, targetDir: string, matchedPattern?: string): boolean {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/?/, '');
    const matchesMatchedPattern = matchedPattern ? minimatch(normalized, matchedPattern) : true;
    if (!matchesMatchedPattern) {
      return false;
    }

    const isUniversal = matchesUniversalPattern(normalized, targetDir);
    let importMatch: { platformId: string; pattern: string } | null = null;

    if (!isUniversal) {
      // Platform-specific paths (declared by import flow "from" patterns in platforms.jsonc)
      const platforms = getPlatformDefinitions(targetDir);
      for (const [platformId, def] of Object.entries(platforms)) {
        const importFlows = def.import || [];
        for (const flow of importFlows) {
          const pattern = getPatternFromFlow(flow as any, 'from');
          if (pattern && minimatch(normalized, pattern)) {
            importMatch = { platformId, pattern };
            break;
          }
        }
        if (importMatch) break;
      }
    }

    const relevant = isUniversal || importMatch !== null;

    return relevant;
  }

  async function walk(dir: string, baseDir: string, opts: { targetDir: string; matchedPattern?: string }): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      // Skip hidden directories and node_modules
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') && entry.name !== '.claude-plugin') {
          continue;
        }
        if (entry.name === 'node_modules') {
          continue;
        }
        
        await walk(fullPath, baseDir, opts);
      } else {
        const relativePath = fullPath.substring(baseDir.length + 1).replace(/\\/g, '/');
        if (!isRelevantPath(relativePath, opts.targetDir, opts.matchedPattern)) {
          continue;
        }
        // Load file content
        try {
          const content = await readFile(fullPath, 'utf-8');
          
          files.push({
            path: relativePath,
            content
          });
        } catch (error) {
          logger.warn(`Failed to read file: ${fullPath}`, { error });
        }
      }
    }
  }
  
  await walk(contentRoot, contentRoot, opts);

  return files;
}
