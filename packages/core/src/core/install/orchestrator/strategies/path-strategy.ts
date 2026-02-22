/**
 * PathInstallStrategy handles installs from local directories/tarballs.
 *
 * It preloads the source once and populates the root resolved package so the unified
 * pipeline can skip re-loading.
 */
import type { InstallationContext, PackageSource } from '../../unified/context.js';
import type { ExecutionContext } from '../../../../types/index.js';
import type { NormalizedInstallOptions, InputClassification, PreprocessResult } from '../types.js';
import { BaseInstallStrategy } from './base.js';
import { getLoaderForSource } from '../../sources/loader-factory.js';
import { normalizePlatforms } from '../../../../utils/platform-mapper.js';

export class PathInstallStrategy extends BaseInstallStrategy {
  readonly name = 'path';
  
  canHandle(classification: InputClassification): boolean {
    return classification.type === 'path';
  }
  
  async buildContext(
    classification: InputClassification,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<InstallationContext> {
    if (classification.type !== 'path') {
      throw new Error('PathStrategy cannot handle non-path classification');
    }
    
    const source: PackageSource = {
      type: 'path',
      packageName: '',
      localPath: classification.localPath,
      sourceType: 'directory' // Could detect tarball here
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
    const loader = getLoaderForSource(context.source);
    const loaded = await loader.load(context.source, options, execContext);
    
    context.source.packageName = loaded.packageName;
    context.source.version = loaded.version;
    context.source.contentRoot = loaded.contentRoot;
    context.source.pluginMetadata = loaded.pluginMetadata;

    context.resolvedPackages = [
      {
        name: context.source.packageName,
        version: context.source.version || loaded.version,
        pkg: {
          metadata: loaded.metadata,
          files: [],
          _format: (loaded.metadata as any)?._format || context.source.pluginMetadata?.format
        },
        isRoot: true,
        source: 'path',
        contentRoot: context.source.contentRoot || loaded.contentRoot
      } as any
    ];
    
    if (loaded.pluginMetadata?.pluginType === 'marketplace') {
      return this.createMarketplaceResult(context);
    }
    
    return this.createNormalResult(context);
  }
}
