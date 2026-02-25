import type { InstallationContext } from './context.js';
import { resolveOutput } from '../../ports/resolve.js';

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
    const out = resolveOutput(ctx.execution);
    out.warn(message);
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
      // For marketplace plugins loaded from cache, show the plugin name
      // instead of exposing the internal cache path
      if (source.pluginMetadata?.marketplaceSource || source.pluginMetadata?.marketplaceEntry) {
        const entryName = source.pluginMetadata.marketplaceEntry?.name;
        return source.packageName || entryName || 'plugin';
      }
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
