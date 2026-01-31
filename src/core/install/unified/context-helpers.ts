import type { InstallationContext } from './context.js';

/**
 * Check if context is for apply mode
 */
export function isApplyMode(ctx: InstallationContext): boolean {
  return ctx.mode === 'apply';
}

/**
 * Check if context should resolve dependencies
 */
export function shouldResolveDependencies(ctx: InstallationContext): boolean {
  // Skip dependency resolution for apply mode and marketplaces
  // Marketplaces don't have dependencies - they're collections of plugins
  if (ctx.mode === 'apply') {
    return false;
  }
  if (ctx.source.pluginMetadata?.pluginType === 'marketplace') {
    return false;
  }
  // Git/path installs are already fully specified by their source content.
  // The registry dependency resolver expects the root package to exist in a registry;
  // for git/path sources this can incorrectly mark the root as "missing" and trigger
  // remote pulls (e.g. Claude marketplace plugins).
  if (ctx.source.type === 'git' || ctx.source.type === 'path') {
    return false;
  }
  // Workspace sources with contentRoot already set (workspace root install) are also
  // fully specified and should not be resolved through the registry. These install
  // workspace-level files from .openpackage/ and the package name in the manifest
  // is just metadata, not a reference to a registry package.
  if (ctx.source.type === 'workspace' && ctx.source.contentRoot) {
    return false;
  }
  return true;
}

/**
 * Check if context should update manifest
 */
export function shouldUpdateManifest(ctx: InstallationContext): boolean {
  // For bulk installs driven by openpackage.yml, the manifest is the source of truth
  // and must not be mutated as a side-effect of installation.
  if (ctx.source.fromWorkspaceManifest) {
    return false;
  }
  return ctx.mode !== 'apply';
}

/**
 * Add warning to context
 */
export function addWarning(ctx: InstallationContext, message: string): void {
  if (!ctx.warnings.includes(message)) {
    ctx.warnings.push(message);
    console.log(`⚠️  ${message}`);
  }
}

/**
 * Add error to context
 */
export function addError(ctx: InstallationContext, message: string): void {
  if (!ctx.errors.includes(message)) {
    ctx.errors.push(message);
  }
}

/**
 * Get display name for source
 */
export function getSourceDisplayName(ctx: InstallationContext): string {
  const { source } = ctx;
  
  switch (source.type) {
    case 'registry':
      return source.version
        ? `${source.packageName}@${source.version}`
        : source.packageName;
    
    case 'path':
      return `${source.packageName} (from ${source.localPath})`;
    
    case 'git':
      const ref = source.gitRef ? `#${source.gitRef}` : '';
      const subdir = source.gitPath ? `&path=${source.gitPath}` : '';
      return `${source.packageName} (git:${source.gitUrl}${ref}${subdir})`;
    
    case 'workspace':
      return `${source.packageName} (workspace)`;
    
    default:
      return source.packageName;
  }
}
