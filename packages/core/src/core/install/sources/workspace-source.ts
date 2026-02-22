import { join } from 'path';
import type { PackageSourceLoader, LoadedPackage } from './base.js';
import type { PackageSource } from '../unified/context.js';
import type { InstallOptions, ExecutionContext } from '../../../types/index.js';
import { SourceLoadError } from './base.js';
import { readWorkspaceIndex } from '../../../utils/workspace-index-yml.js';
import { resolveDeclaredPath } from '../../../utils/path-resolution.js';
import { loadPackageFromPath } from '../path-package-loader.js';

/**
 * Loads packages from workspace index (for apply command)
 */
export class WorkspaceSourceLoader implements PackageSourceLoader {
  canHandle(source: PackageSource): boolean {
    return source.type === 'workspace';
  }
  
  async load(
    source: PackageSource,
    options: InstallOptions,
    execContext: ExecutionContext
  ): Promise<LoadedPackage> {
    if (!source.packageName) {
      throw new SourceLoadError(source, 'Package name is required for workspace sources');
    }
    
    try {
      // Check if contentRoot is already set (workspace root install case)
      if (source.contentRoot) {
        const pkg = await loadPackageFromPath(source.contentRoot, {
          packageName: source.packageName
        });
        const metadata = pkg.metadata;
        const version = source.version || metadata.version || '0.0.0';
        
        return {
          metadata,
          packageName: source.packageName,
          version,
          contentRoot: join(source.contentRoot, '/'),
          source: 'workspace',
          pluginMetadata: (pkg as any)._format ? {
            isPlugin: true,
            pluginType: 'individual',
            format: (pkg as any)._format
          } : undefined
        };
      }
      
      // Standard workspace source loading (from index)
      // Read workspace index (use targetDir for workspace location)
      const { index } = await readWorkspaceIndex(execContext.targetDir);
      const entry = index.packages?.[source.packageName];
      
      if (!entry?.path) {
        throw new SourceLoadError(
          source,
          `Package '${source.packageName}' is not installed in this workspace. ` +
          `Run 'opkg install ${source.packageName}' to install it first.`
        );
      }
      
      // Resolve package path (relative to targetDir)
      const resolved = resolveDeclaredPath(entry.path, execContext.targetDir);
      const contentRoot = join(resolved.absolute, '/');
      
      // Load package metadata (handles regular packages and plugins)
      const pkg = await loadPackageFromPath(contentRoot, {
        packageName: source.packageName,
        gitUrl: source.gitUrl,
        path: source.gitPath
      });
      const metadata = pkg.metadata;
      
      const version = entry.version || metadata.version || '0.0.0';
      
      return {
        metadata,
        packageName: source.packageName,
        version,
        contentRoot,
        source: 'workspace',
        pluginMetadata: (pkg as any)._format ? {
          isPlugin: true,
          pluginType: 'individual',
          format: (pkg as any)._format
        } : undefined
      };
    } catch (error) {
      if (error instanceof SourceLoadError) {
        throw error;
      }
      
      throw new SourceLoadError(
        source,
        `Failed to load package '${source.packageName}' from workspace`,
        error as Error
      );
    }
  }
  
}
