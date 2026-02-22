/**
 * RegistryInstallStrategy handles installs from the OpenPackage registry.
 *
 * Registry sources are loaded by the unified pipeline (load phase), since their metadata
 * and resolution behavior is centralized there.
 */
import type { InstallationContext, PackageSource } from '../../unified/context.js';
import type { ExecutionContext } from '../../../../types/index.js';
import type { NormalizedInstallOptions, InputClassification, PreprocessResult } from '../types.js';
import { BaseInstallStrategy } from './base.js';
import { normalizePlatforms } from '../../../../utils/platform-mapper.js';

export class RegistryInstallStrategy extends BaseInstallStrategy {
  readonly name = 'registry';
  
  canHandle(classification: InputClassification): boolean {
    return classification.type === 'registry';
  }
  
  async buildContext(
    classification: InputClassification,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<InstallationContext> {
    if (classification.type !== 'registry') {
      throw new Error('RegistryStrategy cannot handle non-registry classification');
    }
    
    const source: PackageSource = {
      type: 'registry',
      packageName: classification.packageName,
      version: classification.version,
      resourcePath: classification.resourcePath
    };
    
    return {
      execution: execContext,
      targetDir: execContext.targetDir,
      source,
      mode: 'install',
      options,
      platforms: normalizePlatforms(options.platforms) || [],
      resolvedPackages: [],
      warnings: [],
      errors: []
    };
  }
  
  async preprocess(
    context: InstallationContext,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<PreprocessResult> {
    // Registry sources are handled by the pipeline's load phase
    return this.createNormalResult(context);
  }
}
