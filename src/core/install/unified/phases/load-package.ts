/**
 * Load Package Phase
 * Loads package from source using appropriate loader
 */

import type { InstallationContext } from '../context.js';
import { getLoaderForSource } from '../../sources/loader-factory.js';
import { addError, getSourceDisplayName } from '../context-helpers.js';
import { logger } from '../../../../utils/logger.js';
import { Spinner } from '../../../../utils/spinner.js';
import { applyBaseDetection, computePathScoping } from '../../preprocessing/base-resolver.js';

/**
 * Load package from source
 */
export async function loadPackagePhase(ctx: InstallationContext): Promise<void> {
  // Skip if context already has loaded data (preprocessed by strategy)
  // NOTE: We require resolvedPackages to be populated too; otherwise later phases break.
  if (ctx.source.contentRoot && ctx.source.packageName && ctx.resolvedPackages.length > 0) {
    logger.debug('Skipping load phase - context already preprocessed', {
      packageName: ctx.source.packageName,
      contentRoot: ctx.source.contentRoot
    });
    return;
  }

  logger.debug(`Loading package from ${ctx.source.type} source`);
  
  const spinner = new Spinner('Loading package from source');
  
  try {
    // Get appropriate loader
    const loader = getLoaderForSource(ctx.source);
    
    // Display loading message with spinner
    const displayName = getSourceDisplayName(ctx);
    spinner.update(`Loading ${displayName}`);
    spinner.start();
    
    // Load package
    const loaded = await loader.load(ctx.source, ctx.options, ctx.cwd);
    
    spinner.stop();

    // Update context
    ctx.source.packageName = loaded.packageName;
    ctx.source.version = loaded.version;
    
    // Apply version fallback chain for resource installations (agents/skills)
    // Priority: resourceVersion (from frontmatter) > metadata.version > parent version > undefined
    if (ctx.source.resourceVersion !== undefined) {
      // Resource has explicit version from frontmatter, use it as final version
      const effectiveVersion = ctx.source.resourceVersion;
      logger.debug('Using resource version from frontmatter', {
        packageName: loaded.packageName,
        resourceVersion: ctx.source.resourceVersion,
        parentVersion: loaded.version
      });
      ctx.source.version = effectiveVersion;
    } else if (loaded.metadata?.version && loaded.metadata.version !== loaded.version) {
      // Metadata has different version than loader provided (e.g., openpackage.yml in resource dir)
      const effectiveVersion = loaded.metadata.version;
      logger.debug('Using metadata version for resource', {
        packageName: loaded.packageName,
        metadataVersion: loaded.metadata.version,
        parentVersion: loaded.version
      });
      ctx.source.version = effectiveVersion;
    }
    // Otherwise, keep loaded.version (parent package/plugin version)
    
    // Apply base detection results from loader (resource model).
    // Bulk installs previously missed this, causing unscoped installs and incorrect workspace-index paths.
    applyBaseDetection(ctx, loaded);

    // Ensure contentRoot is always set after load phase
    // This is required by the pipeline validation and may not be set if base detection was skipped
    if (!ctx.source.contentRoot) {
      ctx.source.contentRoot = loaded.contentRoot;
    }

    // If this install targets a concrete resource (file or dir), scope matchedPattern to that resource.
    // This matches the behavior of individual resource installs.
    const resourcePath = (ctx.source as any).resourcePath as string | undefined;
    if (resourcePath) {
      await computePathScoping(ctx, loaded, resourcePath);
    }
    
    ctx.source.pluginMetadata = loaded.pluginMetadata;
    
    // Store commit SHA for git sources (needed for workspace index marketplace metadata)
    if (loaded.sourceMetadata?.commitSha) {
      if (!ctx.source.pluginMetadata) {
        ctx.source.pluginMetadata = { isPlugin: false };
      }
      if (!ctx.source.pluginMetadata.marketplaceSource && loaded.sourceMetadata.commitSha) {
        // Store commit SHA for potential marketplace source tracking
        (ctx.source as any)._commitSha = loaded.sourceMetadata.commitSha;
      }
    }
    
    // Map source type to ResolvedPackage source format
    let resolvedSource: 'local' | 'remote' | 'path' | 'git' | undefined;
    switch (ctx.source.type) {
      case 'registry':
        resolvedSource = 'local'; // Registry packages are local
        break;
      case 'path':
        resolvedSource = 'path';
        break;
      case 'git':
        resolvedSource = 'git';
        break;
      case 'workspace':
        resolvedSource = 'local'; // Workspace packages are local
        break;
    }
    
    // Create root resolved package (simplified - full dependency resolution in next phase)
    // Use the effective version from context (which has fallback chain applied)
    const effectiveVersion = ctx.source.version || loaded.version;
    
    const rootPackage: any = {
      name: loaded.packageName,
      version: effectiveVersion,
      pkg: { 
        metadata: loaded.metadata, 
        files: [], 
        _format: (loaded.metadata as any)?._format || ctx.source.pluginMetadata?.format 
      },
      isRoot: true,
      source: resolvedSource,
      contentRoot: ctx.source.contentRoot || loaded.contentRoot  // Use detected base as content root
    };
    
    // Add marketplace metadata if present
    if (ctx.source.pluginMetadata?.marketplaceSource) {
      rootPackage.marketplaceMetadata = ctx.source.pluginMetadata.marketplaceSource;
    }
    
    // Add resource version if present (for agents/skills with individual versions)
    if (ctx.source.resourceVersion !== undefined) {
      rootPackage.resourceVersion = ctx.source.resourceVersion;
    }
    
    ctx.resolvedPackages = [rootPackage];
    
    logger.info(`Loaded ${loaded.packageName}@${effectiveVersion} from ${loaded.source}`);
    
  } catch (error) {
    spinner.stop();
    const errorMsg = `Failed to load package: ${error}`;
    addError(ctx, errorMsg);
    throw new Error(errorMsg);
  }
}
