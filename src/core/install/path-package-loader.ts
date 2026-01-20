import { relative, basename } from 'path';
import { readFile } from 'fs/promises';
import { Package, PackageFile, PackageYml } from '../../types/index.js';
import { loadPackageConfig } from '../package-context.js';
import { extractPackageFromTarball } from '../../utils/tarball.js';
import { walkFiles, readTextFile } from '../../utils/fs.js';
import { isJunk } from 'junk';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { FILE_PATTERNS, PACKAGE_PATHS, CLAUDE_PLUGIN_PATHS } from '../../constants/index.js';
import { detectPluginType, detectPluginWithMarketplace } from './plugin-detector.js';
import { transformPluginToPackage } from './plugin-transformer.js';
import type { MarketplacePluginEntry } from './marketplace-handler.js';
import * as yaml from 'js-yaml';

export type PathSourceType = 'directory' | 'tarball';

/**
 * Context for loading packages with naming information and marketplace metadata.
 */
export interface PackageLoadContext {
  gitUrl?: string;
  subdirectory?: string;
  repoPath?: string;
  packageName?: string;  // Optional override (avoid using - let transformer generate)
  marketplaceEntry?: MarketplacePluginEntry;
  marketplaceName?: string;
}

/**
 * Infer the source type from a path string.
 */
export function inferSourceType(path: string): PathSourceType {
  return path.endsWith(FILE_PATTERNS.TGZ_FILES) || path.endsWith(FILE_PATTERNS.TAR_GZ_FILES) ? 'tarball' : 'directory';
}

/**
 * Load a package from a local directory.
 * Reads all files from the directory and loads openpackage.yml.
 * 
 * If the directory is a Claude Code plugin, transforms it to OpenPackage format.
 * 
 * @param dirPath - Path to directory
 * @param context - Optional context for scoped naming (GitHub URL, subdirectory)
 */
export async function loadPackageFromDirectory(
  dirPath: string,
  context?: PackageLoadContext
): Promise<Package> {
  logger.debug(`Loading package from directory: ${dirPath}`, { context });
  
  // Check if this is a Claude Code plugin (with marketplace context if available)
  const pluginDetection = await detectPluginWithMarketplace(dirPath, context?.marketplaceEntry);
  
  if (pluginDetection.isPlugin && (pluginDetection.type === 'individual' || pluginDetection.type === 'marketplace-defined')) {
    logger.info(`Detected Claude Code plugin (${pluginDetection.type}), transforming to OpenPackage format`, { dirPath });
    const { package: pkg } = await transformPluginToPackage(dirPath, context);
    return pkg;
  }
  
  // If it's a marketplace, we need to handle plugin selection (done upstream in install command)
  if (pluginDetection.isPlugin && pluginDetection.type === 'marketplace') {
    throw new ValidationError(
      `Directory '${dirPath}' is a Claude Code plugin marketplace. ` +
      `Marketplace installation requires plugin selection and should be handled by the install command.`
    );
  }
  
  // Load openpackage.yml for regular packages
  const config = await loadPackageConfig(dirPath);
  if (!config) {
    throw new ValidationError(
      `Directory '${dirPath}' is not a valid OpenPackage directory or Claude Code plugin. ` +
      `Missing ${FILE_PATTERNS.OPENPACKAGE_YML} or ${CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST}`
    );
  }

  // Discover all files in the directory
  const files: PackageFile[] = [];
  
  try {
    for await (const fullPath of walkFiles(dirPath)) {
      const relativePath = relative(dirPath, fullPath);
      
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
    
    logger.debug(`Loaded ${files.length} files from directory: ${dirPath}`);
    
    return {
      metadata: config,
      files
    };
  } catch (error) {
    logger.error(`Failed to load package from directory: ${dirPath}`, { error });
    throw new ValidationError(`Failed to load package from directory: ${error}`);
  }
}

/**
 * Load a package from a tarball file.
 * Extracts to a temporary location, reads files, then cleans up.
 */
export async function loadPackageFromTarball(tarballPath: string): Promise<Package> {
  logger.debug(`Loading package from tarball: ${tarballPath}`);
  
  // Read tarball file
  let tarballBuffer: Buffer;
  try {
    tarballBuffer = await readFile(tarballPath);
  } catch (error) {
    throw new ValidationError(`Failed to read tarball file '${tarballPath}': ${error}`);
  }
  
  // Extract tarball
  const extracted = await extractPackageFromTarball(tarballBuffer);
  
  // Find openpackage.yml in extracted files
  const packageYmlFile = extracted.files.find(
    f => f.path === PACKAGE_PATHS.MANIFEST_RELATIVE || f.path === 'openpackage.yml'
  );
  
  if (!packageYmlFile) {
    throw new ValidationError(
      `Tarball '${tarballPath}' does not contain a valid ${FILE_PATTERNS.OPENPACKAGE_YML} file`
    );
  }
  
  // Parse openpackage.yml content
  const config = yaml.load(packageYmlFile.content) as PackageYml;
  
  if (!config.name) {
    throw new ValidationError(
      `Tarball '${tarballPath}' contains invalid ${FILE_PATTERNS.OPENPACKAGE_YML}: missing name field`
    );
  }
  
  logger.debug(`Loaded package ${config.name}@${config.version} from tarball: ${tarballPath}`);
  
  return {
    metadata: config,
    files: extracted.files
  };
}

/**
 * Load a package from either a directory or tarball path.
 * Automatically detects the source type.
 * 
 * @param path - Path to package
 * @param context - Optional context for scoped naming
 */
export async function loadPackageFromPath(
  path: string,
  context?: PackageLoadContext
): Promise<Package> {
  const sourceType = inferSourceType(path);
  
  if (sourceType === 'tarball') {
    return await loadPackageFromTarball(path);
  } else {
    return await loadPackageFromDirectory(path, context);
  }
}

