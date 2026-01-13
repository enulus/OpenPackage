import { join, relative, dirname, basename } from 'path';
import { isJunk } from 'junk';
import { Package, PackageFile } from '../types/index.js';
import {
  exists,
  walkFiles,
  readTextFile,
  writeTextFile,
  remove,
  ensureDir
} from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import {
  PackageNotFoundError,
  InvalidPackageError,
} from '../utils/errors.js';
import { validatePackageName } from '../utils/package-name.js';
import {
  getPackagePath,
  getPackageVersionPath,
  getLatestPackageVersion,
  listPackageVersions
} from './directory.js';
import { parsePackageYml, writePackageYml } from '../utils/package-yml.js';
import {
  resolveVersionRange,
  isExactVersion
} from '../utils/version-ranges.js';
import { PACKAGE_PATHS, UNVERSIONED } from '../constants/index.js';
import { getTransformedPlugin } from './install/plugin-transformer.js';

/**
 * Package management operations
 */

export interface PackageVersionState {
  exists: boolean;
  isPartial: boolean;
  paths: string[];
}

interface PackageSaveOptions {
  partial?: boolean;
}

export class PackageManager {
  
  
  /**
   * Load a package from the registry (latest version by default)
   */
  async loadPackage(
    packageName: string,
    version?: string,
    opts?: { packageRootDir?: string }
  ): Promise<Package> {
    logger.debug(`Loading package: ${packageName}`, { version });
    
    validatePackageName(packageName);
    
    // Check if this is a cached transformed plugin
    if (version) {
      const cachedPlugin = getTransformedPlugin(packageName, version);
      if (cachedPlugin) {
        logger.debug(`Using cached transformed plugin: ${packageName}@${version}`);
        return cachedPlugin;
      }
    }
    
    let targetVersion: string | null = opts?.packageRootDir ? version ?? null : null;
    
    if (opts?.packageRootDir) {
      // Use provided root; version comes from manifest.
    } else if (version === UNVERSIONED) {
      targetVersion = UNVERSIONED;
    } else if (version) {
      // Check if it's a version range or exact version
      if (isExactVersion(version)) {
        targetVersion = version;
      } else {
        // It's a version range - resolve it to a specific version
        const availableVersions = await listPackageVersions(packageName);
        if (availableVersions.length === 0) {
          throw new PackageNotFoundError(packageName);
        }
        
        targetVersion = resolveVersionRange(version, availableVersions);
        if (!targetVersion) {
          throw new PackageNotFoundError(
            `No version of '${packageName}' satisfies range '${version}'. Available versions: ${availableVersions.join(', ')}`
          );
        }
        logger.debug(`Resolved version range '${version}' to '${targetVersion}' for package '${packageName}'`);
      }
    } else {
      // No version specified - get latest
      targetVersion = await getLatestPackageVersion(packageName);
    }
    
    if (!targetVersion && !opts?.packageRootDir) {
      throw new PackageNotFoundError(packageName);
    }
    
    const packagePath = opts?.packageRootDir
      ? opts.packageRootDir
      : getPackageVersionPath(packageName, targetVersion ?? undefined);
    if (!(await exists(packagePath))) {
      throw new PackageNotFoundError(packageName);
    }
    
    try {
      // Load openpackage.yml for metadata
      const packageYmlPath = join(packagePath, PACKAGE_PATHS.MANIFEST_RELATIVE);
      if (!(await exists(packageYmlPath))) {
        throw new PackageNotFoundError(packageName);
      }
      
      const metadata = await parsePackageYml(packageYmlPath);
      
      // Discover all files in the package directory
      const files = await this.discoverPackageFiles(packagePath);
      
      return { metadata, files };
    } catch (error) {
      if (error instanceof PackageNotFoundError) {
        throw error;
      }
      logger.error(`Failed to load package: ${packageName}`, { error });
      throw new InvalidPackageError(`Failed to load package: ${error}`);
    }
  }
  
  /**
   * Save a package to the registry (versioned)
   */
  async savePackage(pkg: Package, options: PackageSaveOptions = {}): Promise<void> {
    const { metadata, files } = pkg;
    const packagePath = getPackageVersionPath(metadata.name, metadata.version);
    
    logger.debug(`Saving package: ${metadata.name}@${metadata.version ?? UNVERSIONED}`, { packagePath });
    
    try {
      // Ensure the version directory exists
      await ensureDir(packagePath);
      
      // Save files
      for (const file of files) {
        const fullPath = join(packagePath, file.path);
        await ensureDir(dirname(fullPath));
        await writeTextFile(fullPath, file.content, (file.encoding as BufferEncoding) || 'utf8');
      }
      if (options.partial) {
        await this.markPartialInManifest(packagePath);
      } else {
        await this.clearPartialInManifest(packagePath);
      }
      
      logger.info(`Package '${metadata.name}@${metadata.version}' saved successfully`);
    } catch (error) {
      logger.error(`Failed to save package: ${metadata.name}@${metadata.version}`, { error });
      throw new InvalidPackageError(`Failed to save package: ${error}`);
    }
  }
  
  /**
   * Delete a specific version of a package
   */
  async deletePackageVersion(packageName: string, version: string): Promise<void> {
    logger.info(`Deleting package version: ${packageName}@${version}`);
    
    validatePackageName(packageName);
    
    const packagePath = getPackageVersionPath(packageName, version);
    
    if (!(await exists(packagePath))) {
      throw new PackageNotFoundError(`${packageName}@${version}`);
    }
    
    try {
      await remove(packagePath);
      logger.info(`Package version '${packageName}@${version}' deleted successfully`);
    } catch (error) {
      logger.error(`Failed to delete package version: ${packageName}@${version}`, { error });
      throw new InvalidPackageError(`Failed to delete package version: ${error}`);
    }
  }
  
  /**
   * Delete all versions of a package
   */
  async deletePackage(packageName: string): Promise<void> {
    logger.info(`Deleting all versions of package: ${packageName}`);
    
    validatePackageName(packageName);
    
    const packagePath = getPackagePath(packageName);
    
    if (!(await exists(packagePath))) {
      throw new PackageNotFoundError(packageName);
    }
    
    try {
      await remove(packagePath);
      logger.info(`All versions of package '${packageName}' deleted successfully`);
    } catch (error) {
      logger.error(`Failed to delete package: ${packageName}`, { error });
      throw new InvalidPackageError(`Failed to delete package: ${error}`);
    }
  }
  
  /**
   * Check if a package exists in the registry (any version)
   */
  async packageExists(packageName: string): Promise<boolean> {
    validatePackageName(packageName);
    const latestVersion = await getLatestPackageVersion(packageName);
    return latestVersion !== null;
  }

  /**
   * Return local state for a specific package version, including partial metadata.
   */
  async getPackageVersionState(packageName: string, version?: string): Promise<PackageVersionState> {
    const packagePath = getPackageVersionPath(packageName, version);
    const existsLocally = await exists(packagePath);

    if (!existsLocally) {
      return { exists: false, isPartial: false, paths: [] };
    }

    const manifestPath = join(packagePath, PACKAGE_PATHS.MANIFEST_RELATIVE);
    const manifestExists = await exists(manifestPath);
    let isPartial = !manifestExists;
    if (manifestExists) {
      try {
        const manifest = await parsePackageYml(manifestPath);
        isPartial = Boolean((manifest as any).partial);
      } catch (error) {
        logger.warn('Failed to read package manifest for partial state', { packageName, version, error });
        isPartial = true;
      }
    }

    const paths = await this.listPackageFilePaths(packagePath);

    return { exists: true, isPartial, paths };
  }
  
  /**
   * Discover all files in a package directory
   */

  private async discoverPackageFiles(packagePath: string): Promise<PackageFile[]> {
    const files: PackageFile[] = [];

    try {
      // Include all file types (no filtering)
      // Get all files recursively in the package directory
      for await (const fullPath of walkFiles(packagePath)) {
        const relativePath = relative(packagePath, fullPath);

        // Filter out junk files
        if (isJunk(basename(relativePath))) {
          continue;
        }

        const content = await readTextFile(fullPath);

        files.push({
          path: relativePath,
          content,
          encoding: 'utf8'
        });
      }

      logger.debug(`Discovered ${files.length} files in package directory`, { packagePath });
      return files;
    } catch (error) {
      logger.error(`Failed to discover files in package directory: ${packagePath}`, { error });
      throw new InvalidPackageError(`Failed to discover package files: ${error}`);
    }
  }

  private async markPartialInManifest(packagePath: string): Promise<void> {
    const manifestPath = join(packagePath, PACKAGE_PATHS.MANIFEST_RELATIVE);
    if (!(await exists(manifestPath))) {
      return;
    }

    const manifest = await parsePackageYml(manifestPath);
    (manifest as any).partial = true;
    await writePackageYml(manifestPath, manifest);
  }

  private async clearPartialInManifest(packagePath: string): Promise<void> {
    const manifestPath = join(packagePath, PACKAGE_PATHS.MANIFEST_RELATIVE);
    if (!(await exists(manifestPath))) {
      return;
    }

    const manifest = await parsePackageYml(manifestPath);
    if ((manifest as any).partial !== undefined) {
      delete (manifest as any).partial;
      await writePackageYml(manifestPath, manifest);
    }
  }

  private async listPackageFilePaths(packagePath: string): Promise<string[]> {
    const paths: string[] = [];
    for await (const fullPath of walkFiles(packagePath)) {
      const relativePath = relative(packagePath, fullPath);
      if (isJunk(basename(relativePath))) {
        continue;
      }
      paths.push(relativePath);
    }
    paths.sort();
    return paths;
  }
}

// Create and export a singleton instance
export const packageManager = new PackageManager();

