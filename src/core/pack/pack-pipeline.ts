import path from 'path';
import semver from 'semver';

import type { CommandResult, PackOptions, PackageYml } from '../../types/index.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { ensureRegistryDirectories, getPackageVersionPath } from '../directory.js';
import { readPackageFilesForRegistry, writePackageFilesToDirectory } from '../../utils/package-copy.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists, remove, countFilesInDirectory } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import { resolvePackageByName } from '../../utils/package-name-resolution.js';
import { classifyPackageInput } from '../../utils/package-input.js';
import { ValidationError } from '../../utils/errors.js';
import { promptPackOverwrite } from '../../utils/prompts.js';
import { formatPathForDisplay } from '../../utils/formatters.js';
import { 
  createPackResultInfo, 
  displayPackSuccess, 
  displayPackDryRun 
} from './pack-output.js';
import { assertValidVersion } from '../../utils/validation/version.js';
import { validateAndReadPackageFiles } from '../../utils/validation/package-files.js';
import { writePackageToRegistry } from '../registry-writer.js';

interface ResolvedSource {
  name: string;
  version: string;
  packageRoot: string;
  manifest: PackageYml;
}

async function resolveSource(
  cwd: string,
  packageInput?: string
): Promise<ResolvedSource> {
  // No package input provided - pack CWD as package
  if (!packageInput) {
    const manifestPath = path.join(cwd, FILE_PATTERNS.OPENPACKAGE_YML);
    if (!(await exists(manifestPath))) {
      throw new Error('No openpackage.yml found in current directory; specify a package name or run inside a package root.');
    }
    const manifest = await parsePackageYml(manifestPath);
    return {
      name: manifest.name,
      version: manifest.version ?? '',
      packageRoot: cwd,
      manifest
    };
  }

  // Classify the input to determine if it's a path, tarball, or package name
  const classification = await classifyPackageInput(packageInput, cwd);

  let packageRoot: string;

  // Handle different input types
  if (classification.type === 'directory') {
    // Direct path to package directory
    packageRoot = classification.resolvedPath!;
    logger.info('Resolved package input as directory path', { path: packageRoot });
  } else if (classification.type === 'tarball') {
    // Tarball input is not supported for pack
    throw new ValidationError(
      `Pack command does not support tarball inputs.\n` +
      `To pack from a tarball, first extract it to a directory.`
    );
  } else if (classification.type === 'git') {
    // Git input is not supported for pack
    throw new ValidationError(
      `Pack command does not support git inputs.\n` +
      `To pack from a git repository, first clone it to a directory.`
    );
  } else {
    // Registry type or package name - use name resolution
    // Priority: CWD (if name matches) → Workspace → Global
    // Skip registry (already immutable) and remote (not relevant)
    const resolution = await resolvePackageByName({
      cwd,
      packageName: packageInput,
      checkCwd: true,           // Check if CWD is the package (highest priority)
      searchWorkspace: true,    // Search workspace packages
      searchGlobal: true,       // Search global packages
      searchRegistry: false     // Skip registry (already packed/immutable)
    });

    if (!resolution.found || !resolution.path) {
      throw new Error(
        `Package '${packageInput}' not found.\n` +
        `Searched: current directory, workspace packages (.openpackage/packages/), and global packages (~/.openpackage/packages/).\n` +
        `Make sure the package exists in one of these locations.`
      );
    }

    packageRoot = resolution.path;

    // Log resolution info for debugging/transparency
    if (resolution.resolutionInfo) {
      const { selected, reason } = resolution.resolutionInfo;
      logger.info('Resolved package for packing', {
        packageInput,
        selectedSource: selected.type,
        version: selected.version,
        path: selected.path,
        reason
      });

      // User-friendly message about where package was found
      const sourceLabel = selected.type === 'cwd' ? 'current directory' :
                         selected.type === 'workspace' ? 'workspace packages' :
                         selected.type === 'global' ? 'global packages' : selected.type;
      console.log(`✓ Found ${packageInput} in ${sourceLabel}`);
    }
  }

  // Load manifest from resolved path
  const manifestPath = path.join(packageRoot, FILE_PATTERNS.OPENPACKAGE_YML);
  if (!(await exists(manifestPath))) {
    throw new Error(`openpackage.yml not found at ${manifestPath}`);
  }

  const manifest = await parsePackageYml(manifestPath);

  return {
    name: manifest.name,
    version: manifest.version ?? '',
    packageRoot,
    manifest
  };
}

export interface PackPipelineResult {
  destination: string;
  files: number;
}

/**
 * Handle overwrite confirmation for pack operation
 * Returns true if operation should proceed, false if cancelled
 * Throws error if confirmation is needed but environment is non-interactive
 */
async function handlePackOverwrite(
  packageName: string,
  version: string,
  destination: string,
  existingFileCount: number,
  force: boolean,
  isCustomOutput: boolean
): Promise<boolean> {
  // Force mode - auto-approve with logging
  if (force) {
    const locationType = isCustomOutput ? 'output directory' : 'registry';
    logger.info(
      `Force mode: Overwriting existing ${locationType}`,
      { packageName, version, destination, existingFileCount }
    );
    console.log(
      `⚠️  Force mode: Overwriting ${packageName}@${version} ` +
      `(${existingFileCount} existing file${existingFileCount !== 1 ? 's' : ''})`
    );
    return true;
  }

  // Check if we can prompt (TTY required for interactive prompts)
  const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  
  if (!canPrompt) {
    // Non-interactive environment - fail with clear error message
    const locationType = isCustomOutput ? 'output directory' : 'registry';
    const displayPath = formatPathForDisplay(destination, process.cwd());
    throw new Error(
      `Pack destination already exists (${locationType}: ${displayPath}).\n` +
      `Use --force to overwrite, or specify a different version in openpackage.yml.`
    );
  }

  // Interactive mode - prompt user
  return await promptPackOverwrite(
    packageName,
    version,
    destination,
    existingFileCount,
    isCustomOutput
  );
}

export async function runPackPipeline(
  packageInput: string | undefined,
  options: PackOptions = {}
): Promise<CommandResult<PackPipelineResult>> {
  const cwd = process.cwd();

  try {
    const source = await resolveSource(cwd, packageInput);

    // Validate version using shared utility
    try {
      assertValidVersion(source.version, { context: 'pack' });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    // Read and validate package files using shared utility
    const files = await validateAndReadPackageFiles(source.packageRoot, {
      context: 'pack'
    });

    const destination = options.output
      ? path.resolve(cwd, options.output)
      : getPackageVersionPath(source.name, source.version);

    const isCustomOutput = !!options.output;

    // For registry output, use shared registry writer
    if (!isCustomOutput) {
      const result = await writePackageToRegistry(
        source.name,
        source.version,
        files,
        {
          force: options.force,
          dryRun: options.dryRun,
          context: 'pack'
        }
      );
      
      // Create result info for output display
      const resultInfo = createPackResultInfo(
        source.name,
        source.version,
        source.packageRoot,
        result.destination,
        result.fileCount,
        source.manifest,
        false, // isCustomOutput
        result.overwritten,
        result.overwritten ? result.fileCount : 0
      );
      
      if (options.dryRun) {
        displayPackDryRun(resultInfo, cwd);
      } else {
        displayPackSuccess(resultInfo, cwd);
      }
      
      return {
        success: true,
        data: { destination: result.destination, files: result.fileCount }
      };
    }

    // Custom output path - handle separately with existing logic
    const destinationExists = await exists(destination);
    const existingFileCount = destinationExists 
      ? await countFilesInDirectory(destination)
      : 0;

    // Create result info for output display
    const resultInfo = createPackResultInfo(
      source.name,
      source.version,
      source.packageRoot,
      destination,
      files.length,
      source.manifest,
      isCustomOutput,
      destinationExists,
      existingFileCount
    );

    if (options.dryRun) {
      displayPackDryRun(resultInfo, cwd);
      return {
        success: true,
        data: { destination, files: files.length }
      };
    }

    // Handle overwrite confirmation (unless dry-run or force)
    if (destinationExists) {
      const shouldOverwrite = await handlePackOverwrite(
        source.name,
        source.version,
        destination,
        existingFileCount,
        options.force ?? false,
        isCustomOutput
      );
      
      if (!shouldOverwrite) {
        return {
          success: false,
          error: 'Pack operation cancelled by user'
        };
      }
    }

    // Remove existing destination if present
    if (destinationExists) {
      await remove(destination);
    }

    await writePackageFilesToDirectory(destination, files);

    logger.info(`Packed ${source.name}@${source.version} to ${destination}`);

    // Display success output
    displayPackSuccess(resultInfo, cwd);

    return {
      success: true,
      data: { destination, files: files.length }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
