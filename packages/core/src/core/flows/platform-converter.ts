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
import type { PackageConversionContext } from '../../types/conversion-context.js';
import type { Platform } from '../platforms.js';
import type { Flow, FlowContext, FlowResult } from '../../types/flows.js';
import type { PackageFormat } from '../install/format-detector.js';
import { 
  detectPackageFormat, 
  isPlatformSpecific,
  needsConversion 
} from '../install/format-detector.js';
import { getPlatformDefinition, getGlobalImportFlows } from '../platforms.js';
import { createFlowExecutor } from './flow-executor.js';
import { logger } from '../../utils/logger.js';
import { ensureDir, writeTextFile, readTextFile } from '../../utils/fs.js';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { minimatch } from 'minimatch';
import { 
  createContextFromPackage,
  updateContextAfterConversion,
  withTargetPlatform 
} from '../conversion-context/index.js';

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
 * Conversion options
 */
export interface ConversionOptions {
  dryRun?: boolean;
}

/**
 * Conversion result with updated context
 */
export interface ConversionResult {
  success: boolean;
  convertedPackage?: Package;
  updatedContext?: PackageConversionContext;
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
   * Convert a package to target platform format with conversion context
   * 
   * @param pkg - Package to convert
   * @param context - Conversion context (optional, will be created if not provided)
   * @param targetPlatform - Target platform
   * @param options - Conversion options
   * @returns Conversion result with updated context
   */
  async convert(
    pkg: Package,
    context: PackageConversionContext | undefined,
    targetPlatform: Platform,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    logger.info('Starting platform conversion', {
      package: pkg.metadata.name,
      targetPlatform,
      hasContext: !!context
    });
    
    // Create or use provided context
    const conversionContext = context || createContextFromPackage(pkg);
    
    // Set target platform
    const contextWithTarget = withTargetPlatform(conversionContext, targetPlatform);
    
    // Use provided format if available, otherwise detect from files
    const sourceFormat = pkg._format || detectPackageFormat(pkg.files);
    
    logger.debug('Source format', {
      type: sourceFormat.type,
      platform: sourceFormat.platform,
      confidence: sourceFormat.confidence,
      source: pkg._format ? 'provided' : 'detected',
      contextOriginal: conversionContext.originalFormat.platform
    });
    
    // Build conversion pipeline
    const pipeline = this.buildPipeline(sourceFormat, targetPlatform);
    
    if (!pipeline.needsConversion) {
      logger.info('No conversion needed - formats match');
      return {
        success: true,
        convertedPackage: pkg,
        updatedContext: contextWithTarget,
        stages: []
      };
    }
    
    // Execute pipeline with context
    return await this.executePipeline(pkg, contextWithTarget, pipeline, options);
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

      // IMPORTANT:
      // These "import" flows are defined to read platform-specific paths (e.g. ".claude-plugin/plugin.json")
      // from the source package and write universal outputs (e.g. "openpackage.yml").
      //
      // We should NOT strip the platform prefix here. Doing so turns ".claude-plugin/plugin.json" into
      // "plugin.json", which will not exist in a real Claude plugin repository and makes the
      // platform-to-universal stage a no-op (causing infinite re-detection/re-conversion loops).
      const adjustedFlows = allImportFlows;
      
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
   * Execute conversion pipeline with context
   */
  async executePipeline(
    pkg: Package,
    context: PackageConversionContext,
    pipeline: ConversionPipeline,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    const result: ConversionResult = {
      success: true,
      stages: []
    };
    
    let currentPackage = pkg;
    let currentContext = context;
    const dryRun = options?.dryRun ?? false;
    
    // Create temporary directory for intermediate files
    let tempDir: string | null = null;
    
    try {
      tempDir = await mkdtemp(join(tmpdir(), 'opkg-convert-'));
      
      for (const stage of pipeline.stages) {
        logger.info(`Executing conversion stage: ${stage.name}`);
        
        const stageResult = await this.executeStage(
          currentPackage,
          currentContext,
          stage,
          tempDir,
          dryRun,
          pipeline.target
        );
        
        result.stages.push({
          stage: stage.name,
          filesProcessed: stageResult.filesProcessed,
          success: stageResult.success,
          error: stageResult.error
        });
        
        if (!stageResult.success) {
          result.success = false;
          result.updatedContext = currentContext;
          return result;
        }
        
        // Update package with converted files
        if (stageResult.convertedFiles) {
          currentPackage = {
            ...currentPackage,
            files: stageResult.convertedFiles,
            // Update format to universal (source platform tracked in context)
            _format: {
              type: 'universal',
              platform: undefined,
              confidence: 1.0,
              analysis: {
                universalFiles: stageResult.convertedFiles.length,
                platformSpecificFiles: 0,
                detectedPlatforms: new Map(),
                totalFiles: stageResult.convertedFiles.length,
                samplePaths: {
                  universal: stageResult.convertedFiles.slice(0, 3).map(f => f.path),
                  platformSpecific: []
                }
              }
            }
          };
          
          // Update context after conversion
          currentContext = updateContextAfterConversion(
            currentContext,
            { type: 'universal', platform: undefined },
            pipeline.target
          );
        }
      }
      
      result.convertedPackage = currentPackage;
      result.updatedContext = currentContext;
      return result;
      
    } catch (error) {
      logger.error('Conversion pipeline failed', { error });
      result.success = false;
      result.updatedContext = currentContext;
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
    pattern: string | string[] | import('../../types/flows.js').SwitchExpression,
    baseDir: string
  ): Promise<string[]> {
    // Handle switch expressions
    if (typeof pattern === 'object' && '$switch' in pattern) {
      throw new Error('Cannot discover files from SwitchExpression - expression must be resolved first');
    }
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
        // IMPORTANT: conversion must match dotfiles like ".claude-plugin/plugin.json".
        // If dotfiles don't match, platform-to-universal stages can become no-ops and loop forever.
        if (minimatch(relativePath, p, { dot: true })) {
          matches.push(filePath);
          break; // Only match once per file
        }
      }
    }
    
    return matches;
  }
  
  /**
   * Execute a single conversion stage with context
   */
  private async executeStage(
    pkg: Package,
    context: PackageConversionContext,
    stage: ConversionStage,
    tempDir: string,
    dryRun: boolean,
    targetPlatform: Platform
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
      const matchedSources = new Set<string>();
      
      // Create isolated input/output roots for this stage
      const stageRoot = join(tempDir, stage.name);
      const packageRoot = join(stageRoot, 'in');
      const outputRoot = join(stageRoot, 'out');
      await ensureDir(packageRoot);
      await ensureDir(outputRoot);
      
      // Write package files to temp directory
      for (const file of pkg.files) {
        const filePath = join(packageRoot, file.path);
        await ensureDir(join(filePath, '..'));
        await writeTextFile(filePath, file.content);
      }
      
      // Build flow context with proper platform variables for conditional evaluation
      // During conversion, we set:
      // - $$platform = target platform (for conditionals like "$eq": ["$$platform", "claude"])
      // - $$source = original source format (for conditionals like "$eq": ["$$source", "claude-plugin"])
      const flowContext: FlowContext = {
        workspaceRoot: outputRoot,  // Write outputs away from inputs
        packageRoot,
        platform: targetPlatform,  // Use target platform for conditional evaluation
        packageName: pkg.metadata.name,
        direction: 'install',  // Always use 'install' direction for conversion
        variables: {
          name: pkg.metadata.name,
          version: pkg.metadata.version || '0.0.0',
          platform: targetPlatform,  // For conditional: "$eq": ["$$platform", "claude"]
          source: context.originalFormat.platform || 'openpackage',  // Use context for $$source
          sourcePlatform: context.originalFormat.platform || 'openpackage',  // Use context for sourcePlatform
          targetPlatform: targetPlatform
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
          matchedSources.add(sourceRelative);
          
          // Create concrete flow with specific file path
          const concreteFlow: Flow = {
            ...flow,
            from: sourceRelative
          };
          
          const flowResult = await executor.executeFlow(concreteFlow, flowContext);
          
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
            const targetPath = relative(outputRoot, flowResult.target);
            
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
