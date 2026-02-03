import type { InstallationContext } from './context.js';

/**
 * Check if context should resolve dependencies
 */
export function shouldResolveDependencies(ctx: InstallationContext): boolean {
  // Skip dependency resolution for apply mode
  if (ctx.mode === 'apply') {
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
  return (
    ctx.mode !== 'apply' &&
    ctx.source.type !== 'workspace' &&
    ctx.options.skipManifestUpdate !== true
  );
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
