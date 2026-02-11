import type { PackageSourceLoader, LoadedPackage } from './base.js';
import type { PackageSource } from '../unified/context.js';
import type { InstallOptions, ExecutionContext } from '../../../types/index.js';
import { SourceLoadError } from './base.js';
import { parsePackageYml } from '../../../utils/package-yml.js';
import {
  resolvePackageContentRoot,
  detectWorkspaceMutableSource,
  detectGlobalMutableSource
} from '../local-source-resolution.js';
import { resolveRegistryVersion } from '../../source-resolution/resolve-registry-version.js';
import { hasPackageVersion } from '../../directory.js';
import { pullPackageFromRemote } from '../../remote-pull.js';
import { join } from 'path';

/**
 * Loads packages from the local registry
 */
export class RegistrySourceLoader implements PackageSourceLoader {
  canHandle(source: PackageSource): boolean {
    return source.type === 'registry';
  }
  
  async load(
    source: PackageSource,
    options: InstallOptions,
    execContext: ExecutionContext
  ): Promise<LoadedPackage> {
    if (!source.packageName) {
      throw new SourceLoadError(source, 'Package name is required for registry sources');
    }
    
    // Resolve version to latest when not specified (regression fix for regular registry installs)
    if (!source.version) {
      const resolved = await resolveRegistryVersion(source.packageName, {
        mode: options.resolutionMode ?? 'default',
        profile: options.profile,
        apiKey: options.apiKey
      });
      source.version = resolved.version;
    }
    
    // If package is not available (workspace, global, or registry) and mode allows remote, pull first
    const mode = options.resolutionMode ?? 'default';
    const inWorkspace = await detectWorkspaceMutableSource(execContext.targetDir, source.packageName);
    const inGlobal = await detectGlobalMutableSource(source.packageName);
    const inRegistry = await hasPackageVersion(source.packageName, source.version);
    const availableLocally = !!(inWorkspace || inGlobal || inRegistry);

    if (!availableLocally && mode !== 'local-only') {
      const pullResult = await pullPackageFromRemote(source.packageName, source.version, {
        profile: options.profile,
        apiKey: options.apiKey,
        skipLocalCheck: mode === 'remote-primary'
      });
      if (!pullResult.success) {
        const reason = pullResult.reason ?? 'unknown';
        const message = pullResult.message ?? 'Remote pull failed';
        throw new SourceLoadError(
          source,
          `Package ${source.packageName}@${source.version} not in local registry and remote pull failed: ${message} (reason: ${reason})`
        );
      }
    } else if (availableLocally && mode === 'remote-primary') {
      const pullResult = await pullPackageFromRemote(source.packageName, source.version, {
        profile: options.profile,
        apiKey: options.apiKey,
        skipLocalCheck: true
      });
      if (!pullResult.success) {
        const reason = pullResult.reason ?? 'unknown';
        const message = pullResult.message ?? 'Remote pull failed';
        throw new SourceLoadError(
          source,
          `--remote: Package ${source.packageName}@${source.version} remote pull failed: ${message} (reason: ${reason})`
        );
      }
    }
    if (!availableLocally && mode === 'local-only') {
      throw new SourceLoadError(
        source,
        `Package ${source.packageName}@${source.version} not found in local registry. Use default resolution (remove --local) to pull from remote.`
      );
    }
    
    try {
      // Resolve content root (use targetDir for registry location)
      const contentRoot = await resolvePackageContentRoot({
        cwd: execContext.targetDir,
        packageName: source.packageName,
        version: source.version
      });
      
      // Load package metadata
      const manifestPath = join(contentRoot, 'openpackage.yml');
      const metadata = await parsePackageYml(manifestPath);
      
      return {
        metadata,
        packageName: source.packageName,
        version: source.version,
        contentRoot,
        source: 'registry'
      };
    } catch (error) {
      throw new SourceLoadError(
        source,
        `Failed to load package ${source.packageName}@${source.version} from registry`,
        error as Error
      );
    }
  }
  
}
