import { Command } from 'commander';
import type { CommandResult, InstallOptions } from '../types/index.js';
import { withErrorHandling } from '../utils/errors.js';
import { normalizePlatforms } from '../utils/platform-mapper.js';
import { buildInstallContext } from '../core/install/unified/context-builders.js';
import { runUnifiedInstallPipeline } from '../core/install/unified/pipeline.js';
import { determineResolutionMode } from '../utils/resolution-mode.js';
import { DIR_PATTERNS, PACKAGE_PATHS } from '../constants/index.js';
import { normalizePathForProcessing } from '../utils/path-normalization.js';
import type { InstallationContext } from '../core/install/unified/context.js';
import type { LoadedPackage } from '../core/install/sources/base.js';
import { getLoaderForSource } from '../core/install/sources/loader-factory.js';

/**
 * Validate that target directory is not inside .openpackage metadata
 */
function assertTargetDirOutsideMetadata(targetDir: string): void {
  const normalized = normalizePathForProcessing(targetDir ?? '.');
  if (!normalized || normalized === '.') {
    return; // default install root
  }

  if (
    normalized === DIR_PATTERNS.OPENPACKAGE ||
    normalized.startsWith(`${DIR_PATTERNS.OPENPACKAGE}/`)
  ) {
    throw new Error(
      `Installation target '${targetDir}' cannot point inside ${DIR_PATTERNS.OPENPACKAGE} ` +
      `(reserved for metadata like ${PACKAGE_PATHS.INDEX_RELATIVE}). ` +
      `Choose a workspace path outside metadata.`
    );
  }
}

/**
 * Validate resolution flags
 */
export function validateResolutionFlags(options: InstallOptions & { local?: boolean; remote?: boolean }): void {
  if (options.remote && options.local) {
    throw new Error('--remote and --local cannot be used together. Choose one resolution mode.');
  }
}

/**
 * Main install command handler
 */
async function installCommand(
  packageInput: string | undefined,
  options: InstallOptions
): Promise<CommandResult> {
  const cwd = process.cwd();
  const targetDir = '.';
  
  // Validate inputs
  assertTargetDirOutsideMetadata(targetDir);
  validateResolutionFlags(options);
  
  // Set resolution mode
  options.resolutionMode = determineResolutionMode(options);
  
  // Build context(s)
  const contexts = await buildInstallContext(cwd, packageInput, options);
  
  // Handle bulk install (multiple contexts)
  if (Array.isArray(contexts)) {
    return await runBulkInstall(contexts);
  }
  
  // For git sources, we need to load the package first to detect if it's a marketplace
  // Marketplaces are detected during loadPackagePhase, so we need to check after loading
  if (contexts.source.type === 'git') {
    // Load package to detect marketplace
    const loader = getLoaderForSource(contexts.source);
    const loaded = await loader.load(contexts.source, options, cwd);
    
    // Update context with loaded info
    contexts.source.packageName = loaded.packageName;
    contexts.source.version = loaded.version;
    contexts.source.contentRoot = loaded.contentRoot;
    contexts.source.pluginMetadata = loaded.pluginMetadata;
    
    // Check if marketplace - handle at command level
    if (contexts.source.pluginMetadata?.pluginType === 'marketplace') {
      return await handleMarketplaceInstallation(contexts, options, cwd);
    }
    
    // Not a marketplace, continue with normal pipeline
    // Create resolved package for the loaded package
    contexts.resolvedPackages = [{
      name: loaded.packageName,
      version: loaded.version,
      pkg: { metadata: loaded.metadata, files: [], _format: undefined },
      isRoot: true,
      source: 'git',
      contentRoot: loaded.contentRoot
    }];
  }
  
  // Single package install
  return await runUnifiedInstallPipeline(contexts);
}

/**
 * Handle marketplace installation with plugin selection
 */
async function handleMarketplaceInstallation(
  context: InstallationContext,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  const {
    parseMarketplace,
    promptPluginSelection,
    installMarketplacePlugins
  } = await import('../core/install/marketplace-handler.js');
  const { Spinner } = await import('../utils/spinner.js');
  
  // Load the marketplace package (already loaded, use context data)
  if (!context.source.pluginMetadata?.manifestPath) {
    throw new Error('Marketplace manifest not found');
  }
  
  const spinner = new Spinner('Loading marketplace');
  spinner.start();
  
  // Parse marketplace manifest
  const marketplace = await parseMarketplace(context.source.pluginMetadata.manifestPath, {
    repoPath: context.source.contentRoot
  });
  
  spinner.stop();
  
  // Prompt user to select plugins
  const selectedPlugins = await promptPluginSelection(marketplace);
  
  if (selectedPlugins.length === 0) {
    console.log('No plugins selected. Installation cancelled.');
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  // Install selected plugins using marketplace handler
  // At this point we know it's a git source with a gitUrl
  if (context.source.type !== 'git' || !context.source.gitUrl) {
    throw new Error('Marketplace must be from a git source');
  }
  
  return await installMarketplacePlugins(
    context.source.contentRoot!,
    marketplace,
    selectedPlugins,
    context.source.gitUrl,
    context.source.gitRef,
    options,
    cwd
  );
}

/**
 * Run bulk installation for multiple packages
 */
async function runBulkInstall(contexts: InstallationContext[]): Promise<CommandResult> {
  if (contexts.length === 0) {
    console.log('⚠️  No packages found in openpackage.yml');
    console.log('\n💡 Tips:');
    console.log('  • Add packages to the "packages" array in openpackage.yml');
    console.log('  • Add development packages to the "dev-packages" array');
    console.log('  • Use "opkg install <package-name>" to install a specific package');
    return { success: true, data: { installed: 0, skipped: 0 } };
  }
  
  console.log(`\n✓ Installing ${contexts.length} package${contexts.length === 1 ? '' : 's'} from openpackage.yml\n`);
  
  let totalInstalled = 0;
  let totalSkipped = 0;
  const results: Array<{ name: string; success: boolean; error?: string }> = [];
  
  for (const ctx of contexts) {
    try {
      const result = await runUnifiedInstallPipeline(ctx);
      
      if (result.success) {
        totalInstalled++;
        results.push({ name: ctx.source.packageName, success: true });
        console.log(`✓ ${ctx.source.packageName}`);
      } else {
        totalSkipped++;
        results.push({ name: ctx.source.packageName, success: false, error: result.error });
        console.log(`❌ ${ctx.source.packageName}: ${result.error}`);
      }
    } catch (error) {
      totalSkipped++;
      results.push({ name: ctx.source.packageName, success: false, error: String(error) });
      console.log(`❌ ${ctx.source.packageName}: ${error}`);
    }
  }
  
  // Display summary
  console.log(`\n✓ Installation complete: ${totalInstalled} installed${totalSkipped > 0 ? `, ${totalSkipped} failed` : ''}`);
  
  const allSuccessful = totalSkipped === 0;
  return {
    success: allSuccessful,
    data: { installed: totalInstalled, skipped: totalSkipped, results },
    error: allSuccessful ? undefined : `${totalSkipped} packages failed to install`
  };
}

/**
 * Setup install command
 */
export function setupInstallCommand(program: Command): void {
  program
    .command('install')
    .alias('i')
    .description('Install packages to workspace')
    .argument(
      '[package-name]',
      'name of the package to install (optional - installs all from openpackage.yml if not specified). ' +
      'Supports package@version syntax.'
    )
    .option('--dry-run', 'preview changes without applying them')
    .option('--force', 'overwrite existing files')
    .option('--conflicts <strategy>', 'conflict handling strategy: keep-both, overwrite, skip, or ask')
    .option('--dev', 'add package to dev-packages instead of packages')
    .option('--platforms <platforms...>', 'prepare specific platforms (e.g., cursor claudecode opencode)')
    .option('--remote', 'pull and install from remote registry, ignoring local versions')
    .option('--local', 'resolve and install using only local registry versions, skipping remote metadata and pulls')
    .option('--profile <profile>', 'profile to use for authentication')
    .option('--api-key <key>', 'API key for authentication (overrides profile)')
    .action(withErrorHandling(async (packageName: string | undefined, options: InstallOptions) => {
      // Normalize platforms
      options.platforms = normalizePlatforms(options.platforms);

      // Normalize conflict strategy
      const commandOptions = options as InstallOptions & { conflicts?: string };
      const rawConflictStrategy = commandOptions.conflicts ?? options.conflictStrategy;
      if (rawConflictStrategy) {
        const normalizedStrategy = (rawConflictStrategy as string).toLowerCase();
        const allowedStrategies: InstallOptions['conflictStrategy'][] = [
          'keep-both', 'overwrite', 'skip', 'ask'
        ];
        if (!allowedStrategies.includes(normalizedStrategy as InstallOptions['conflictStrategy'])) {
          throw new Error(
            `Invalid --conflicts value '${rawConflictStrategy}'. ` +
            `Use one of: keep-both, overwrite, skip, ask.`
          );
        }
        options.conflictStrategy = normalizedStrategy as InstallOptions['conflictStrategy'];
      }

      // Execute install
      const result = await installCommand(packageName, options);
      
      if (!result.success) {
        if (result.error === 'Package not found') {
          return; // Already displayed message
        }
        throw new Error(result.error || 'Installation operation failed');
      }
    }));
}
