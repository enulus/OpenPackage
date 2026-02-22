/**
 * Format Conversion Installation Strategy
 * 
 * Converts package from source format → universal → target platform format.
 * 
 * This strategy performs per-platform conversion to handle conditional flows
 * that depend on the target platform (e.g., `when: { "$eq": ["$$platform", "claude"] }`).
 * 
 * Each target platform gets its own conversion pass with proper context variables:
 * - $$platform = target platform (for conditional evaluation)
 * - $$source = original source format (preserved through conversion)
 * 
 * Used when source platform ≠ target platform.
 */

import { join, relative } from 'path';
import type { Platform } from '../../platforms.js';
import type { Package } from '../../../types/index.js';
import type { PackageConversionContext } from '../../../types/conversion-context.js';
import type { PackageFormat } from '../format-detector.js';
import type { InstallOptions } from '../../../types/index.js';
import type { FlowInstallContext, FlowInstallResult } from './types.js';
import { BaseStrategy } from './base-strategy.js';
import { needsConversion, detectPackageFormat } from '../format-detector.js';
import { createPlatformConverter } from '../../flows/platform-converter.js';
import { walkFiles } from '../../../utils/file-walker.js';
import { readTextFile } from '../../../utils/fs.js';
import { logger } from '../../../utils/logger.js';
import {
  createTempPackageDirectory,
  writeTempPackageFiles,
  writeConversionContext,
  cleanupTempDirectory
} from './helpers/temp-directory.js';
import { createContextFromFormat } from '../../conversion-context/index.js';
import { FlowBasedInstallStrategy } from './flow-based-strategy.js';

/**
 * Format Conversion Installation Strategy
 * 
 * Performs per-platform conversion to ensure conditional flows have
 * correct context variables during transformation.
 */
export class ConversionInstallStrategy extends BaseStrategy {
  readonly name = 'conversion';
  
  canHandle(format: PackageFormat, platform: Platform): boolean {
    return needsConversion(format, platform);
  }
  
  async install(
    context: FlowInstallContext,
    options?: InstallOptions,
    forceOverwrite: boolean = false
  ): Promise<FlowInstallResult> {
    const { packageName, packageRoot, workspaceRoot, platform, dryRun } = context;
    
    this.logStrategySelection(context);
    
    logger.info(`Converting ${packageName} from ${context.packageFormat?.platform || 'unknown'} to ${platform} format`);
    
    try {
      // Phase 1: Load package files
      const packageFiles = await this.loadPackageFiles(packageRoot);
      
      // Phase 2: Create package object with original format metadata
      const pkg: Package = {
        metadata: {
          name: packageName,
          version: context.packageVersion
        },
        files: packageFiles,
        _format: context.packageFormat || await this.detectFormat(packageRoot)
      };
      
      // Phase 3: Create conversion context and convert FOR the specific target platform
      // This ensures conditional flows like `when: { "$eq": ["$$platform", "claude"] }`
      // have the correct context during conversion
      const conversionContext = createContextFromFormat(pkg._format!);
      
      const converter = createPlatformConverter(workspaceRoot);
      const conversionResult = await converter.convert(
        pkg,
        conversionContext,  // Pass conversion context
        platform,  // Target platform
        { dryRun }
      );
      
      if (!conversionResult.success || !conversionResult.convertedPackage) {
        logger.error('Package conversion failed', {
          package: packageName,
          stages: conversionResult.stages
        });
        
        return this.createErrorResult(
          context,
          new Error('Conversion failed'),
          'Failed to convert package format'
        );
      }
      
      logger.info(
        `Conversion to universal format complete (${conversionResult.stages.length} stages), ` +
        `now applying ${platform} platform flows`
      );
      
      // Phase 4: Write converted files to temp directory and install
      return await this.installConvertedPackage(
        conversionResult.convertedPackage,
        conversionResult.updatedContext || conversionContext,
        context,
        options,
        forceOverwrite
      );
      
    } catch (error) {
      logger.error('Conversion installation failed', { packageName, error });
      return this.createErrorResult(
        context,
        error as Error,
        `Failed to install with conversion: ${(error as Error).message}`
      );
    }
  }
  
  /**
   * Load all package files from directory
   */
  private async loadPackageFiles(packageRoot: string): Promise<Array<{ path: string; content: string }>> {
    const packageFiles: Array<{ path: string; content: string }> = [];
    
    for await (const sourcePath of walkFiles(packageRoot)) {
      const relativePath = relative(packageRoot, sourcePath);
      
      if (relativePath.startsWith('.openpackage/') || relativePath === 'openpackage.yml') {
        continue;
      }
      
      const content = await readTextFile(sourcePath);
      packageFiles.push({ path: relativePath, content, encoding: 'utf8' } as any);
    }
    
    return packageFiles;
  }
  
  /**
   * Detect package format from directory
   */
  private async detectFormat(packageRoot: string): Promise<PackageFormat> {
    const files: Array<{ path: string; content: string }> = [];
    
    for await (const fullPath of walkFiles(packageRoot)) {
      const relativePath = relative(packageRoot, fullPath);
      
      if (relativePath.startsWith('.git/') || relativePath === '.git') {
        continue;
      }
      
      files.push({ path: relativePath, content: '' });
    }
    
    return detectPackageFormat(files);
  }
  
  /**
   * Install converted package from temp directory with context
   */
  private async installConvertedPackage(
    convertedPackage: Package,
    conversionContext: PackageConversionContext,
    context: FlowInstallContext,
    options?: InstallOptions,
    forceOverwrite: boolean = false
  ): Promise<FlowInstallResult> {
    let tempPackageRoot: string | null = null;
    
    try {
      // Create temp directory
      tempPackageRoot = await createTempPackageDirectory();
      
      // Write converted files
      await writeTempPackageFiles(convertedPackage.files, tempPackageRoot);
      
      // Write conversion context (persists through temp directory)
      await writeConversionContext(conversionContext, tempPackageRoot);
      
      // Install from temp directory using flow-based installation
      const flowStrategy = new FlowBasedInstallStrategy();
      
      const convertedContext: FlowInstallContext = {
        ...context,
        packageRoot: tempPackageRoot,
        // Updated package format after conversion
        packageFormat: convertedPackage._format,
        // Pass updated conversion context
        conversionContext
      };
      
      const installResult = await flowStrategy.install(convertedContext, options, forceOverwrite);
      
      // Cleanup temp directory
      await cleanupTempDirectory(tempPackageRoot);
      
      return installResult;
      
    } catch (error) {
      await cleanupTempDirectory(tempPackageRoot);
      
      logger.error('Failed to install converted package', { 
        packageName: context.packageName, 
        error 
      });
      
      return this.createErrorResult(
        context,
        error as Error,
        `Failed to install converted package: ${(error as Error).message}`
      );
    }
  }
}
