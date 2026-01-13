/**
 * Platform Converter Module
 * 
 * High-level orchestration for converting packages between formats:
 * - Platform-specific → Universal → Platform-specific
 * - Direct installation when source = target platform
 */

import { join, relative } from 'path';
import { promises as fs } from 'fs';
import type { Package, PackageFile } from '../../types/index.js';
import type { Platform } from '../platforms.js';
import type { Flow, FlowContext, FlowResult } from '../../types/flows.js';
import type { PackageFormat } from '../install/format-detector.js';
import { 
  detectPackageFormat, 
  isPlatformSpecific,
  shouldInstallDirectly,
  needsConversion 
} from '../install/format-detector.js';
import { getPlatformDefinition, getGlobalImportFlows } from '../platforms.js';
import { createFlowExecutor } from './flow-executor.js';
import { logger } from '../../utils/logger.js';
import { ensureDir, writeTextFile, readTextFile } from '../../utils/fs.js';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { minimatch } from 'minimatch';

/**
 * Conversion pipeline stage
 */
export interface ConversionStage {
  name: string;
  description: string;
  flows: Flow[];
  inverted: boolean;
}

/**
 * Conversion pipeline definition
 */
export interface ConversionPipeline {
  source: PackageFormat;
  target: Platform;
  stages: ConversionStage[];
  needsConversion: boolean;
}

/**
 * Conversion result
 */
export interface ConversionResult {
  success: boolean;
  convertedPackage?: Package;
  stages: Array<{
    stage: string;
    filesProcessed: number;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Platform Converter
 * 
 * Orchestrates multi-stage conversions between package formats
 */
export class PlatformConverter {
  private workspaceRoot: string;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }
  
  /**
   * Convert a package to target platform format
   */
  async convert(
    pkg: Package,
    targetPlatform: Platform,
    options?: {
      dryRun?: boolean;
    }
  ): Promise<ConversionResult> {
    logger.info('Starting platform conversion', {
      package: pkg.metadata.name,
      targetPlatform
    });
    
    // Use provided format if available, otherwise detect from files
    const sourceFormat = pkg._format || detectPackageFormat(pkg.files);
    
    logger.debug('Source format', {
      type: sourceFormat.type,
      platform: sourceFormat.platform,
      confidence: sourceFormat.confidence,
      source: pkg._format ? 'provided' : 'detected'
    });
    
    // Build conversion pipeline
    const pipeline = this.buildPipeline(sourceFormat, targetPlatform);
    
    if (!pipeline.needsConversion) {
      logger.info('No conversion needed - formats match');
      return {
        success: true,
        convertedPackage: pkg,
        stages: []
      };
    }
    
    // Execute pipeline
    return await this.executePipeline(pkg, pipeline, options);
  }
  
  /**
   * Build conversion pipeline based on source and target formats
   */
  buildPipeline(
    sourceFormat: PackageFormat,
    targetPlatform: Platform
  ): ConversionPipeline {
    const stages: ConversionStage[] = [];
    const needsConv = needsConversion(sourceFormat, targetPlatform);
    
    logger.info('Checking if conversion needed', {
      sourceType: sourceFormat.type,
      sourcePlatform: sourceFormat.platform,
      targetPlatform,
      needsConversion: needsConv
    });
    
    if (!needsConv) {
      return {
        source: sourceFormat,
        target: targetPlatform,
        stages: [],
        needsConversion: false
      };
    }
    
    // Platform-specific → Universal
    if (isPlatformSpecific(sourceFormat) && sourceFormat.platform) {
      const sourcePlatform = sourceFormat.platform;
      
      // Get source platform import flows (these transform workspace → package)
      const platformDef = getPlatformDefinition(sourcePlatform, this.workspaceRoot);
      const platformImportFlows = platformDef.import || [];
      const globalImportFlows = getGlobalImportFlows(this.workspaceRoot) || [];
      
      const allImportFlows = [...globalImportFlows, ...platformImportFlows];
      
      logger.info(`Building conversion stage with ${allImportFlows.length} import flows`, {
        sourcePlatform,
        flowCount: allImportFlows.length
      });
      
      // For plugins: files are already in universal structure, just need content transformation
      // Import flows already have correct paths (workspace → package)
      // Adjust for plugins where workspace files are in universal locations
      const adjustedFlows = allImportFlows.map(flow => {
        // Import flows have 'from' as workspace path and 'to' as package path
        // For plugins, workspace paths may need adjustment
        const platformPrefix = `.${sourcePlatform}/`;
        
        // Handle both string and array 'from' patterns
        const fromPatterns = Array.isArray(flow.from) ? flow.from : [flow.from];
        const adjustedFromPatterns = fromPatterns.map(fromPattern => {
          if (fromPattern.startsWith(platformPrefix)) {
            return fromPattern.substring(platformPrefix.length);
          }
          return fromPattern;
        });
        
        // Return adjusted flow
        if (Array.isArray(flow.from)) {
          return { ...flow, from: adjustedFromPatterns };
        } else {
          return { ...flow, from: adjustedFromPatterns[0] };
        }
      });
      
      stages.push({
        name: 'platform-to-universal',
        description: `Convert from ${sourcePlatform} format to universal format`,
        flows: adjustedFlows,
        inverted: false  // Not inverted - using import flows directly
      });
    }
    
    // Universal → Target Platform
    // Note: This stage will be handled by the normal flow-based installer
    // We only need to convert TO universal here; the installer handles universal → platform
    
    return {
      source: sourceFormat,
      target: targetPlatform,
      stages,
      needsConversion: true
    };
  }
  
  /**
   * Execute conversion pipeline
   */
  async executePipeline(
    pkg: Package,
    pipeline: ConversionPipeline,
    options?: {
      dryRun?: boolean;
    }
  ): Promise<ConversionResult> {
    const result: ConversionResult = {
      success: true,
      stages: []
    };
    
    let currentPackage = pkg;
    const dryRun = options?.dryRun ?? false;
    
    // Create temporary directory for intermediate files
    let tempDir: string | null = null;
    
    try {
      tempDir = await mkdtemp(join(tmpdir(), 'opkg-convert-'));
      
      for (const stage of pipeline.stages) {
        logger.info(`Executing conversion stage: ${stage.name}`);
        
        const stageResult = await this.executeStage(
          currentPackage,
          stage,
          tempDir,
          dryRun
        );
        
        result.stages.push({
          stage: stage.name,
          filesProcessed: stageResult.filesProcessed,
          success: stageResult.success,
          error: stageResult.error
        });
        
        if (!stageResult.success) {
          result.success = false;
          return result;
        }
        
        // Update package with converted files
        if (stageResult.convertedFiles) {
          currentPackage = {
            ...currentPackage,
            files: stageResult.convertedFiles
          };
        }
      }
      
      result.convertedPackage = currentPackage;
      return result;
      
    } catch (error) {
      logger.error('Conversion pipeline failed', { error });
      result.success = false;
      result.stages.push({
        stage: 'pipeline',
        filesProcessed: 0,
        success: false,
        error: (error as Error).message
      });
      return result;
      
    } finally {
      // Cleanup temp directory
      if (tempDir) {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch (error) {
          logger.warn('Failed to cleanup temp directory', { tempDir, error });
        }
      }
    }
  }
  
  /**
   * Discover files matching a glob pattern
   */
  private async discoverMatchingFiles(
    pattern: string | string[],
    baseDir: string
  ): Promise<string[]> {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    const matches: string[] = [];
    
    // Walk all files in baseDir
    async function* walkFiles(dir: string): AsyncGenerator<string> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          yield* walkFiles(fullPath);
        } else if (entry.isFile()) {
          yield fullPath;
        }
      }
    }
    
    // Check each file against the patterns
    for await (const filePath of walkFiles(baseDir)) {
      const relativePath = relative(baseDir, filePath);
      
      // Check if file matches any pattern (with priority - first match wins for arrays)
      for (const p of patterns) {
        if (minimatch(relativePath, p, { dot: false })) {
          matches.push(filePath);
          break; // Only match once per file
        }
      }
    }
    
    return matches;
  }
  
  /**
   * Execute a single conversion stage
   */
  private async executeStage(
    pkg: Package,
    stage: ConversionStage,
    tempDir: string,
    dryRun: boolean
  ): Promise<{
    success: boolean;
    filesProcessed: number;
    convertedFiles?: PackageFile[];
    error?: string;
  }> {
    try {
      const executor = createFlowExecutor();
      const convertedFiles: PackageFile[] = [];
      let filesProcessed = 0;
      
      // Create a temporary package root with source files
      const packageRoot = join(tempDir, 'source');
      await ensureDir(packageRoot);
      
      // Write package files to temp directory
      for (const file of pkg.files) {
        const filePath = join(packageRoot, file.path);
        await ensureDir(join(filePath, '..'));
        await writeTextFile(filePath, file.content);
      }
      
      // Build flow context
      const context: FlowContext = {
        workspaceRoot: tempDir,  // Use temp dir as workspace
        packageRoot,
        platform: 'claude' as Platform,  // Temporary platform for conversion context
        packageName: pkg.metadata.name,
        direction: 'install',  // Always use 'install' direction for conversion (inverted flows handle the logic)
        variables: {
          name: pkg.metadata.name,
          version: pkg.metadata.version || '0.0.0'
        },
        dryRun
      };
      
      // Execute flows for each matching file
      for (const flow of stage.flows) {
        // Discover files that match the flow's 'from' pattern
        const matchingFiles = await this.discoverMatchingFiles(
          flow.from,
          packageRoot
        );
        
        logger.info(`Flow pattern matching`, {
          pattern: flow.from,
          matchCount: matchingFiles.length,
          matches: matchingFiles.map(f => relative(packageRoot, f))
        });
        
        if (matchingFiles.length === 0) {
          logger.debug('No files match flow pattern', { 
            pattern: flow.from,
            packageRoot 
          });
          continue;
        }
        
        // Execute flow for each matching file
        for (const sourceFile of matchingFiles) {
          const sourceRelative = relative(packageRoot, sourceFile);
          
          // Create concrete flow with specific file path
          const concreteFlow: Flow = {
            ...flow,
            from: sourceRelative
          };
          
          const flowResult = await executor.executeFlow(concreteFlow, context);
          
          if (!flowResult.success) {
            return {
              success: false,
              filesProcessed,
              error: `Flow execution failed for ${sourceRelative}: ${flowResult.error?.message}`
            };
          }
          
          filesProcessed++;
          
          // Collect transformed files
          if (typeof flowResult.target === 'string') {
            const targetPath = relative(tempDir, flowResult.target);
            
            // Read transformed file content
            try {
              const content = await readTextFile(flowResult.target);
              
              convertedFiles.push({
                path: targetPath,
                content,
                encoding: 'utf8'
              });
            } catch (error) {
              logger.warn('Failed to read converted file', { 
                target: flowResult.target, 
                error 
              });
            }
          }
        }
      }
      
      return {
        success: true,
        filesProcessed,
        convertedFiles: convertedFiles.length > 0 ? convertedFiles : undefined
      };
      
    } catch (error) {
      logger.error('Stage execution failed', { stage: stage.name, error });
      return {
        success: false,
        filesProcessed: 0,
        error: (error as Error).message
      };
    }
  }
}

/**
 * Create a platform converter instance
 */
export function createPlatformConverter(workspaceRoot: string): PlatformConverter {
  return new PlatformConverter(workspaceRoot);
}
