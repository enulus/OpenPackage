import path from 'path';
import { 
  ensureRegistryDirectories, 
  getPackageVersionPath,
} from './directory.js';
import { exists, remove, countFilesInDirectory } from '../utils/fs.js';
import { writePackageFilesToDirectory } from '../utils/package-copy.js';
import { promptPackOverwrite } from '../utils/prompts.js';
import { formatPathForDisplay } from '../utils/formatters.js';
import { logger } from '../utils/logger.js';
import { isUnversionedPackage } from '../utils/validation/version.js';
import type { PackageFile } from '../types/index.js';

export interface RegistryWriteOptions {
  /** Force overwrite without prompting */
  force?: boolean;
  /** Dry run mode - don't actually write */
  dryRun?: boolean;
  /** Context for logging/errors (e.g., "pack", "publish") */
  context?: string;
}

export interface RegistryWriteResult {
  destination: string;
  fileCount: number;
  overwritten: boolean;
}

/**
 * Write package files to local registry
 * Handles overwrite confirmation, directory setup, and file writing
 */
export async function writePackageToRegistry(
  packageName: string,
  version: string,
  files: PackageFile[],
  options: RegistryWriteOptions = {}
): Promise<RegistryWriteResult> {
  const { force = false, dryRun = false, context = 'operation' } = options;
  
  // Get destination path
  const destination = getPackageVersionPath(packageName, version);
  
  // Check if destination exists
  const destinationExists = await exists(destination);
  const existingFileCount = destinationExists 
    ? await countFilesInDirectory(destination)
    : 0;
  
  // Handle overwrite logic
  let shouldOverwrite = true;
  
  if (destinationExists) {
    const unversioned = isUnversionedPackage(version);
    
    if (unversioned) {
      // Unversioned packages: auto-overwrite with log message
      logger.info(
        `Updating unversioned package ${packageName}@${version}`,
        { destination, existingFileCount }
      );
      console.log(
        `⚠️  Updating ${packageName}@${version} ` +
        `(${existingFileCount} existing file${existingFileCount !== 1 ? 's' : ''})`
      );
    } else if (force) {
      // Force mode: auto-approve with logging
      logger.info(
        `Force mode: Overwriting ${packageName}@${version}`,
        { destination, existingFileCount }
      );
      console.log(
        `⚠️  Force mode: Overwriting ${packageName}@${version} ` +
        `(${existingFileCount} existing file${existingFileCount !== 1 ? 's' : ''})`
      );
    } else {
      // Versioned packages: require confirmation
      const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      
      if (!canPrompt) {
        // Non-interactive environment - fail with clear error
        const displayPath = formatPathForDisplay(destination, process.cwd());
        throw new Error(
          `Package ${packageName}@${version} already exists in registry (${displayPath}).\n` +
          `Use --force to overwrite, or update the version in openpackage.yml.`
        );
      }
      
      // Interactive mode - prompt user
      shouldOverwrite = await promptPackOverwrite(
        packageName,
        version,
        destination,
        existingFileCount,
        false // isCustomOutput
      );
      
      if (!shouldOverwrite) {
        throw new Error(`${context} cancelled by user`);
      }
    }
  }
  
  // Dry run - return without writing
  if (dryRun) {
    return {
      destination,
      fileCount: files.length,
      overwritten: destinationExists
    };
  }
  
  // Ensure registry directories exist
  await ensureRegistryDirectories();
  
  // Remove existing destination if overwriting
  if (destinationExists) {
    await remove(destination);
  }
  
  // Write files to registry
  await writePackageFilesToDirectory(destination, files);
  
  logger.info(`Wrote ${packageName}@${version} to registry`, {
    destination,
    fileCount: files.length,
    context
  });
  
  return {
    destination,
    fileCount: files.length,
    overwritten: destinationExists
  };
}
