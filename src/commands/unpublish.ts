import { Command } from 'commander';
import prompts from 'prompts';

import { withErrorHandling, ValidationError, PackageNotFoundError, UserCancellationError } from '../utils/errors.js';
import { runUnpublishPipeline } from '../core/unpublish/unpublish-pipeline.js';
import type { UnpublishOptions } from '../core/unpublish/unpublish-types.js';
import { safePrompts, promptConfirmation } from '../utils/prompts.js';
import { 
  listAllPackages, 
  listPackageVersions, 
  getPackageVersionPath,
  findPackageByName 
} from '../core/directory.js';
import { getDirectorySize, countFilesInDirectory } from '../utils/fs.js';
import { formatFileSize, formatFileCount } from '../utils/formatters.js';
import { normalizePackageName } from '../utils/package-name.js';

interface UnpublishCommandOptions extends UnpublishOptions {
  list?: boolean;
}

/**
 * Format package choice for selection list
 */
function formatPackageChoice(name: string, versionCount: number): string {
  const plural = versionCount !== 1 ? 's' : '';
  return `${name} (${versionCount} version${plural})`;
}

/**
 * Format version choice for selection list
 */
function formatVersionChoice(
  version: string, 
  fileCount: number, 
  size: number
): string {
  return `${version} (${formatFileCount(fileCount)}, ${formatFileSize(size)})`;
}

/**
 * Interactive package selection from registry
 * Returns selected package name or null if cancelled/empty
 */
async function selectPackageFromList(): Promise<string | null> {
  const packages = await listAllPackages();
  
  if (packages.length === 0) {
    return null;
  }
  
  // Build choices with version counts
  const choices = await Promise.all(
    packages.map(async (name) => {
      const versions = await listPackageVersions(name);
      return {
        title: formatPackageChoice(name, versions.length),
        value: name
      };
    })
  );
  
  console.log(`  ${packages.length} package${packages.length === 1 ? '' : 's'} in local registry\n`);
  
  const response = await safePrompts({
    type: 'select',
    name: 'package',
    message: 'Select package to unpublish:',
    choices,
    hint: 'Use arrow keys to navigate, Enter to select'
  });
  
  return response.package || null;
}

/**
 * Interactive version selection for a package
 * Returns array of selected version strings
 */
async function selectVersionsFromPackage(
  packageName: string
): Promise<string[]> {
  const versions = await listPackageVersions(packageName);
  
  if (versions.length === 0) {
    return [];
  }
  
  // Build choices with file count and size metadata
  const choices = await Promise.all(
    versions.map(async (version) => {
      const versionPath = getPackageVersionPath(packageName, version);
      const fileCount = await countFilesInDirectory(versionPath);
      const size = await getDirectorySize(versionPath);
      
      return {
        title: formatVersionChoice(version, fileCount, size),
        value: version
      };
    })
  );
  
  console.log(`  ${versions.length} version${versions.length === 1 ? '' : 's'} available\n`);
  
  const response = await prompts(
    {
      type: 'multiselect',
      name: 'versions',
      message: `Select versions of '${packageName}' to unpublish:`,
      choices,
      hint: '- Space: select/deselect \u2022 Enter: confirm',
      min: 1,
      instructions: false
    },
    {
      onCancel: () => {
        throw new UserCancellationError('Operation cancelled by user');
      }
    }
  );
  
  return response.versions || [];
}

/**
 * Handle interactive unpublish with --list option
 * Note: --list automatically implies --local mode
 */
async function handleListUnpublish(
  packageSpec: string | undefined,
  options: UnpublishCommandOptions
): Promise<void> {
  // --list always operates on local registry (no validation needed)
  // The --local flag is auto-implied by the action handler
  
  let selectedPackage: string | null = null;
  
  // Step 1: Determine package (either from spec or interactive selection)
  if (packageSpec) {
    // Package specified - validate it exists
    const normalizedName = normalizePackageName(packageSpec);
    const exists = await findPackageByName(normalizedName);
    
    if (!exists) {
      throw new PackageNotFoundError(normalizedName);
    }
    
    selectedPackage = exists;
  } else {
    // No package specified - show interactive package selector
    selectedPackage = await selectPackageFromList();
    
    if (!selectedPackage) {
      console.log('No packages found in local registry.');
      return;
    }
  }
  
  // Step 2: Select versions to unpublish
  const selectedVersions = await selectVersionsFromPackage(selectedPackage);
  
  if (selectedVersions.length === 0) {
    console.log('No versions selected. Unpublish cancelled.');
    return;
  }
  
  // Step 3: Show summary
  console.log(`\n\u2713 Selected ${selectedVersions.length} version${selectedVersions.length === 1 ? '' : 's'} to unpublish:`);
  for (const version of selectedVersions) {
    console.log(`  \u2022 ${selectedPackage}@${version}`);
  }
  console.log('');
  
  // Step 4: Final confirmation (unless --force)
  if (!options.force) {
    const confirmed = await promptConfirmation(
      'This will delete the selected versions from the local registry. Continue?',
      false
    );
    
    if (!confirmed) {
      console.log('Unpublish cancelled.');
      return;
    }
  }
  
  // Step 5: Process each version
  for (const version of selectedVersions) {
    const packageSpecWithVersion = `${selectedPackage}@${version}`;
    
    try {
      const result = await runUnpublishPipeline(packageSpecWithVersion, {
        ...options,
        force: true  // Already confirmed, skip individual prompts
      });
      
      if (!result.success) {
        console.error(`Failed to unpublish ${packageSpecWithVersion}: ${result.error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to unpublish ${packageSpecWithVersion}: ${message}`);
    }
  }
}

export function setupUnpublishCommand(program: Command): void {
  program
    .command('unpublish')
    .argument('[package-spec]', 'package[@version] to unpublish (e.g., my-package@1.0.0)')
    .description('Remove package from remote registry (use --local for local unpublishing)')
    .option('--local', 'unpublish from local registry (~/.openpackage/registry)')
    .option('--force', 'skip confirmation prompts')
    .option('-l, --list', 'interactively select packages/versions to unpublish (implies --local)')
    .option('--profile <profile>', 'profile to use for authentication (remote only)')
    .option('--api-key <key>', 'API key for authentication (remote only, overrides profile)')
    .action(withErrorHandling(async (packageSpec: string | undefined, options: UnpublishCommandOptions) => {
      // Handle interactive list mode
      if (options.list) {
        // Auto-imply --local when --list is used (list only works with local registry)
        options.local = true;
        await handleListUnpublish(packageSpec, options);
        return;
      }
      
      // Validate package spec is provided for non-list mode
      if (!packageSpec) {
        throw new Error('Package specification is required. Usage: opkg unpublish <package[@version]> or use --list for interactive selection');
      }
      
      // Run unpublish pipeline (routes to local or remote)
      const result = await runUnpublishPipeline(packageSpec, options);
      if (!result.success) {
        throw new Error(result.error || 'Unpublish operation failed');
      }
    }));
}
