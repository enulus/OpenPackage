import type { InstallationContext, PackageSource } from '../../unified/context.js';
import type { 
  NormalizedInstallOptions, 
  InputClassification, 
  PreprocessResult 
} from '../types.js';
import { BaseInstallStrategy } from './base.js';
import { getLoaderForSource } from '../../sources/loader-factory.js';
import { buildResourceInstallContexts } from '../../unified/context-builders.js';
import { normalizePlatforms } from '../../../../utils/platform-mapper.js';
import { logger } from '../../../../utils/logger.js';
import { applyBaseDetection, computePathScoping } from '../../preprocessing/base-resolver.js';
import { resolveConvenienceResources } from '../../preprocessing/convenience-preprocessor.js';

export class GitInstallStrategy extends BaseInstallStrategy {
  readonly name = 'git';
  
  canHandle(classification: InputClassification): boolean {
    return classification.type === 'git';
  }
  
  async buildContext(
    classification: InputClassification,
    options: NormalizedInstallOptions,
    cwd: string
  ): Promise<InstallationContext> {
    if (classification.type !== 'git') {
      throw new Error('GitStrategy cannot handle non-git classification');
    }
    
    const source: PackageSource = {
      type: 'git',
      packageName: '', // Populated after loading
      gitUrl: classification.gitUrl,
      gitRef: classification.gitRef,
      resourcePath: classification.resourcePath
    };
    
    return {
      source,
      mode: 'install',
      options,
      platforms: normalizePlatforms(options.platforms) || [],
      cwd,
      targetDir: '.',
      resolvedPackages: [],
      warnings: [],
      errors: []
    };
  }
  
  async preprocess(
    context: InstallationContext,
    options: NormalizedInstallOptions,
    cwd: string
  ): Promise<PreprocessResult> {
    // Load the source
    const loader = getLoaderForSource(context.source);
    const loaded = await loader.load(context.source, options, cwd);
    
    // Update context with loaded info
    context.source.packageName = loaded.packageName;
    context.source.version = loaded.version;
    context.source.contentRoot = loaded.contentRoot;
    context.source.pluginMetadata = loaded.pluginMetadata;
    
    // Store commitSha for marketplace
    if (loaded.sourceMetadata?.commitSha) {
      (context.source as any)._commitSha = loaded.sourceMetadata.commitSha;
    }
    
    // Check for marketplace (early exit)
    if (loaded.pluginMetadata?.pluginType === 'marketplace') {
      return this.createMarketplaceResult(context);
    }
    
    // Process base detection (centralized)
    const baseResult = applyBaseDetection(context, loaded);
    if (baseResult.specialHandling === 'marketplace') {
      return this.createMarketplaceResult(context);
    }
    if (baseResult.specialHandling === 'ambiguous') {
      return this.createAmbiguousResult(context, baseResult.ambiguousMatches ?? []);
    }
    
    // Apply resource path scoping
    const resourcePath = context.source.resourcePath;
    if (resourcePath) {
      await computePathScoping(context, loaded, resourcePath);
    }

    // Populate root resolved package so the pipeline can skip re-loading.
    // (The unified load phase is the only other place that populates ctx.resolvedPackages.)
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
        source: 'git',
        contentRoot: context.source.contentRoot || loaded.contentRoot
      } as any
    ];
    
    // Apply convenience filters (--agents, --skills)
    if (options.agents?.length || options.skills?.length) {
      return this.handleConvenienceFilters(context, loaded, options, cwd);
    }
    
    // Warn about unused --plugins flag
    if (options.plugins?.length && !options.agents && !options.skills) {
      console.log('Warning: --plugins flag is only used with marketplace sources. Ignoring.');
    }
    
    return this.createNormalResult(context);
  }
  
  /**
   * Handle convenience filter options.
   */
  private async handleConvenienceFilters(
    context: InstallationContext,
    loaded: any,
    options: NormalizedInstallOptions,
    cwd: string
  ): Promise<PreprocessResult> {
    const basePath = context.detectedBase || loaded.contentRoot || cwd;
    const repoRoot = loaded.sourceMetadata?.repoPath || loaded.contentRoot || basePath;

    const resources = await resolveConvenienceResources(basePath, repoRoot, {
      agents: options.agents,
      skills: options.skills
    });

    const resourceContexts = buildResourceInstallContexts(context, resources, repoRoot);
    return this.createMultiResourceResult(context, resourceContexts);
  }
}
