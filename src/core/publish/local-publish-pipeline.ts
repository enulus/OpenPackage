import { loadAndValidateManifest } from '../../utils/validation/manifest.js';
import { assertValidVersion } from '../../utils/validation/version.js';
import { validateAndReadPackageFiles } from '../../utils/validation/package-files.js';
import { writePackageToRegistry } from '../registry-writer.js';
import { logger } from '../../utils/logger.js';
import type { PublishOptions, PublishResult } from './publish-types.js';

export interface LocalPublishData {
  packageName: string;
  version: string;
  destination: string;
  fileCount: number;
  overwritten: boolean;
}

/**
 * Publish package from CWD to local registry
 * This is the default publish behavior
 */
export async function runLocalPublishPipeline(
  options: PublishOptions
): Promise<PublishResult<LocalPublishData>> {
  const cwd = process.cwd();
  
  try {
    // Load and validate manifest from CWD
    const manifest = await loadAndValidateManifest(cwd, {
      context: 'current directory'
    });
    
    const packageName = manifest.name;
    const version = manifest.version;
    
    // Validate version (stricter rules for publish - no prerelease)
    assertValidVersion(version, {
      rejectPrerelease: true,
      context: 'publish'
    });
    
    logger.info(`Publishing package '${packageName}' from CWD to local registry`, {
      cwd,
      version
    });
    
    // Read and validate package files
    const files = await validateAndReadPackageFiles(cwd, {
      context: 'publish'
    });
    
    // Log summary before writing
    console.log(`\nPublishing '${packageName}@${version}' to local registry...`);
    console.log(`Files: ${files.length}`);
    
    // Write to local registry (handles overwrite logic)
    const result = await writePackageToRegistry(
      packageName,
      version,
      files,
      {
        force: options.force,
        context: 'publish'
      }
    );
    
    // Display success message (match pack style - no emojis)
    console.log(`\n✓ Published ${packageName}@${version} to local registry`);
    console.log(`✓ Location: ${result.destination}`);
    console.log(`✓ Files: ${result.fileCount}`);
    if (result.overwritten) {
      console.log(`✓ Overwrote existing version`);
    }
    
    return {
      success: true,
      data: {
        packageName,
        version,
        destination: result.destination,
        fileCount: result.fileCount,
        overwritten: result.overwritten
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Local publish failed', { error: message, cwd });
    
    return {
      success: false,
      error: message
    };
  }
}
