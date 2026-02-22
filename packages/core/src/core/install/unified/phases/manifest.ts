import type { InstallationContext } from '../context.js';
import { addPackageToYml } from '../../../../utils/package-management.js';
import { formatPathForYaml } from '../../../../utils/path-resolution.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Update manifest phase (openpackage.yml)
 */
export async function updateManifestPhase(ctx: InstallationContext): Promise<void> {
  const mainPackage = ctx.resolvedPackages.find(pkg => pkg.isRoot);
  
  if (!mainPackage) {
    logger.warn(`No root package found in resolved packages, skipping manifest update`);
    return;
  }
  
  try {
    // Determine fields based on source type
    const fields = buildManifestFields(ctx, mainPackage);
    
    await addPackageToYml(
      ctx.targetDir,
      ctx.source.packageName,
      mainPackage.version,
      ctx.options.dev ?? false,
      fields.range,
      fields.force,
      fields.path,
      fields.gitUrl,
      fields.gitRef,
      fields.gitPath,
      fields.base  // Phase 4: Pass base field for resource model
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
    path: undefined,
    gitUrl: undefined,
    gitRef: undefined,
    gitPath: undefined,
    base: undefined  // Phase 4: Base field for resource model
  };
  
  // Check for git source override first (for marketplace plugins)
  // This allows path-based loading with git-based manifest recording
  if (ctx.source.gitSourceOverride) {
    fields.gitUrl = ctx.source.gitSourceOverride.gitUrl;
    fields.gitRef = ctx.source.gitSourceOverride.gitRef;
    // If this install was scoped to a specific resource, record the full repo-relative resource path.
    // This keeps manifest entries logically consistent with ctx.source.packageName (which includes the resource path).
    fields.gitPath = ctx.source.resourcePath ?? ctx.source.gitSourceOverride.gitPath;
    return fields;
  }
  
  // Phase 4: Record base field if user-selected or non-default
  // This ensures reproducible installs when ambiguity was resolved
  if (ctx.baseRelative && ctx.baseSource === 'user-selection') {
    fields.base = ctx.baseRelative;
  }
  
  switch (ctx.source.type) {
    case 'registry':
      // Registry packages get version range
      fields.range = ctx.source.version;
      break;
    
    case 'path':
      // Path packages get path field
      // Use centralized path formatting for consistency with workspace index
      fields.path = formatPathForYaml(ctx.source.localPath || '', ctx.targetDir);
      break;
    
    case 'git':
      // Git packages get git fields
      fields.gitUrl = ctx.source.gitUrl;
      fields.gitRef = ctx.source.gitRef;
      // For resource-scoped installs, prefer recording the concrete resource path (file or dir).
      fields.gitPath = ctx.source.resourcePath ?? ctx.source.gitPath;
      break;
    
    case 'workspace':
      // Workspace (apply) doesn't update manifest
      break;
  }
  
  return fields;
}
