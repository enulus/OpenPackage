import type { InstallationContext } from '../context.js';
import { addPackageToYml } from '../../../../utils/package-management.js';
import { formatPathForYaml } from '../../../../utils/path-resolution.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Update manifest phase (openpackage.yml)
 */
export async function updateManifestPhase(ctx: InstallationContext): Promise<void> {
  logger.debug(`Updating manifest for ${ctx.source.packageName}`);
  
  const mainPackage = ctx.resolvedPackages.find(pkg => pkg.isRoot);
  
  if (!mainPackage) {
    logger.warn(`No root package found in resolved packages, skipping manifest update`);
    return;
  }
  
  try {
    // Determine fields based on source type
    const fields = buildManifestFields(ctx, mainPackage);
    
    await addPackageToYml(
      ctx.cwd,
      ctx.source.packageName,
      mainPackage.version,
      ctx.options.dev ?? false,
      fields.range,
      fields.force,
      fields.include,
      fields.path,
      fields.gitUrl,
      fields.gitRef,
      fields.gitSubdirectory
    );
    
    logger.info(`Updated manifest for ${ctx.source.packageName}`);
    
  } catch (error) {
    logger.warn(`Failed to update manifest: ${error}`);
    // Non-fatal - installation succeeded even if manifest update failed
  }
}

function buildManifestFields(ctx: InstallationContext, mainPackage: any) {
  const fields: any = {
    range: undefined,
    force: true,
    include: undefined,
    path: undefined,
    gitUrl: undefined,
    gitRef: undefined,
    gitSubdirectory: undefined
  };
  
  // Check for git source override first (for marketplace plugins)
  // This allows path-based loading with git-based manifest recording
  if (ctx.source.gitSourceOverride) {
    fields.gitUrl = ctx.source.gitSourceOverride.gitUrl;
    fields.gitRef = ctx.source.gitSourceOverride.gitRef;
    fields.gitSubdirectory = ctx.source.gitSourceOverride.gitSubdirectory;
    return fields;
  }
  
  switch (ctx.source.type) {
    case 'registry':
      // Registry packages get version range
      fields.range = ctx.source.version;
      break;
    
    case 'path':
      // Path packages get path field
      // Use centralized path formatting for consistency with workspace index
      fields.path = formatPathForYaml(ctx.source.localPath || '', ctx.cwd);
      break;
    
    case 'git':
      // Git packages get git fields
      fields.gitUrl = ctx.source.gitUrl;
      fields.gitRef = ctx.source.gitRef;
      fields.gitSubdirectory = ctx.source.gitSubdirectory;
      break;
    
    case 'workspace':
      // Workspace (apply) doesn't update manifest
      break;
  }
  
  return fields;
}
