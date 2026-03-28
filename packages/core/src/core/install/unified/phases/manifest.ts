import type { InstallationContext } from '../context.js';
import { addPackageToYml } from '../../../package-management.js';
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
      fields.base,
      fields.gitUrl,
      fields.gitRef,
      fields.resourcePath,
    );

    logger.info(`Updated manifest for ${ctx.source.packageName}`);

  } catch (error) {
    logger.warn(`Failed to update manifest: ${error}`);
    // Non-fatal - installation succeeded even if manifest update failed
  }
}

export function buildManifestFields(ctx: InstallationContext, mainPackage: any) {
  const fields: any = {
    range: undefined,
    force: true,
    base: undefined,        // path from source root to package root
    resourcePath: undefined, // resource selection within package
    gitUrl: undefined,
    gitRef: undefined,
  };

  // Check for git source override first (for marketplace plugins)
  // This allows path-based loading with git-based manifest recording
  if (ctx.source.gitSourceOverride) {
    fields.gitUrl = ctx.source.gitSourceOverride.gitUrl;
    fields.gitRef = ctx.source.gitSourceOverride.gitRef;
    // Split: gitPath → base (subdirectory), resourcePath → path (resource selection)
    fields.base = ctx.source.gitSourceOverride.gitPath;
    fields.resourcePath = ctx.source.resourcePath;
    return fields;
  }

  // Mutable source override: auto-discovered workspace/global packages → name-only
  // The resolved path goes to the lockfile, not the manifest.
  if (ctx.source.mutableSourceOverride) {
    // Name-only entry — return empty fields
    return fields;
  }

  // Record base field for reproducible installs
  if (ctx.baseRelative) {
    fields.base = ctx.baseRelative;
  }

  switch (ctx.source.type) {
    case 'registry':
      // Registry packages get version range
      fields.range = ctx.source.version;
      break;

    case 'path':
      // Explicit path packages: source location → base field
      fields.base = formatPathForYaml(ctx.source.localPath || '', ctx.targetDir);
      break;

    case 'git':
      // Git packages: url + base (subdirectory) + resourcePath (resource selection)
      fields.gitUrl = ctx.source.gitUrl;
      fields.gitRef = ctx.source.gitRef;
      fields.base = ctx.source.gitPath || undefined; // subdirectory (omit if repo root)
      fields.resourcePath = ctx.source.resourcePath;  // resource selection (omit if full)
      break;

    case 'workspace':
      // Workspace (apply) doesn't update manifest
      break;
  }

  return fields;
}
