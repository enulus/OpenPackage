import path from 'path';
import { assertValidVersion } from '../../utils/validation/version.js';
import { validateAndReadPackageFiles } from '../../utils/validation/package-files.js';
import { writePackageToRegistry } from '../registry-writer.js';
import { logger } from '../../utils/logger.js';
import { parsePackageYml } from '../../utils/package-yml.js';
import { exists } from '../../utils/fs.js';
import { resolvePackageByName } from '../../utils/package-name-resolution.js';
import { classifyPackageInput } from '../../utils/package-input.js';
import { ValidationError } from '../../utils/errors.js';
import { formatPathForDisplay } from '../../utils/formatters.js';
import { formatVersionLabel } from '../../utils/package-versioning.js';
import { createPublishResultInfo, displayPublishSuccess } from './publish-output.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import type { PublishOptions, PublishResult } from './publish-types.js';
import type { PackageYml } from '../../types/index.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

export interface LocalPublishData {
  packageName: string;
  version: string;
  sourcePath: string;
  destination: string;
  fileCount: number;
  overwritten: boolean;
}

interface ResolvedSource {
  name: string;
  version: string;
  packageRoot: string;
  manifest: PackageYml;
}

async function resolveSource(
  cwd: string,
  packageInput?: string,
  output?: OutputPort
): Promise<ResolvedSource> {
  // No package input provided - publish from CWD
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
    // Tarball input is not supported for local publish
    throw new ValidationError(
      `Local publish does not support tarball inputs.\n` +
      `To publish from a tarball, first extract it to a directory.`
    );
  } else if (classification.type === 'git') {
    // Git input is not supported for local publish
    throw new ValidationError(
      `Local publish does not support git inputs.\n` +
      `To publish from a git repository, first clone it to a directory.`
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
      logger.info('Resolved package for publishing', {
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
      const out = output ?? resolveOutput();
      out.success(`Found ${packageInput} in ${sourceLabel}`);
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

/**
 * Publish package from CWD or specified source to local registry
 * This is the local publish behavior (requires --local flag after refactor)
 */
export async function runLocalPublishPipeline(
  packageInput: string | undefined,
  options: PublishOptions,
  output?: OutputPort
): Promise<PublishResult<LocalPublishData>> {
  const out = output ?? resolveOutput();
  const cwd = process.cwd();
  
  try {
    // Resolve package source (CWD, path, or package name)
    const source = await resolveSource(cwd, packageInput, output);
    
    const packageName = source.name;
    const version = source.version;
    
    // For local publish, allow unversioned packages (default to 0.0.0)
    let publishVersion = version;
    
    if (!version || version.trim() === '') {
      publishVersion = '0.0.0';
      out.info(`No version specified, using 0.0.0 for local publish`);
      logger.info('Auto-assigned version 0.0.0 for unversioned package', { packageName });
    } else {
      // Validate provided version (reject prereleases)
      assertValidVersion(version, {
        rejectPrerelease: true,
        context: 'local publish'
      });
    }
    
    logger.info(`Publishing package '${packageName}' to local registry`, {
      source: source.packageRoot,
      version: publishVersion
    });
    
    // Read and validate package files
    const files = await validateAndReadPackageFiles(source.packageRoot, {
      context: 'publish'
    });
    
    // Write to local registry (handles overwrite logic)
    const result = await writePackageToRegistry(
      packageName,
      publishVersion,
      files,
      {
        force: options.force,
        context: 'publish'
      }
    );
    
    // Create result info for output display
    const resultInfo = createPublishResultInfo(
      packageName,
      publishVersion,
      source.packageRoot,
      result.destination,
      result.fileCount,
      source.manifest,
      false, // isCustomOutput
      result.overwritten,
      result.overwritten ? result.fileCount : 0
    );
    
    // Display success with rich formatting
    displayPublishSuccess(resultInfo, cwd);
    
    return {
      success: true,
      data: {
        packageName,
        version: publishVersion,
        sourcePath: source.packageRoot,
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
