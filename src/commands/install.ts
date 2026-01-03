import { Command } from 'commander';
import { resolve } from 'path';

import type { CommandResult, InstallOptions } from '../types/index.js';
import { formatPathForDisplay } from '../utils/formatters.js';
import { DIR_PATTERNS, PACKAGE_PATHS } from '../constants/index.js';
import { runBulkInstallPipeline } from '../core/install/bulk-install-pipeline.js';
import { runInstallPipeline, determineResolutionMode } from '../core/install/install-pipeline.js';
import { runPathInstallPipeline } from '../core/install/path-install-pipeline.js';
import { loadPackageFromGit } from '../core/install/git-package-loader.js';
import { inferSourceType } from '../core/install/path-package-loader.js';
import { detectPluginType } from '../core/install/plugin-detector.js';
import { 
  parseMarketplace, 
  promptPluginSelection, 
  installMarketplacePlugins 
} from '../core/install/marketplace-handler.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { normalizePlatforms } from '../utils/platform-mapper.js';
import { classifyPackageInput } from '../utils/package-input.js';
import { findExistingPathOrGitSource } from '../utils/install-helpers.js';
import { logger } from '../utils/logger.js';
import { normalizePathForProcessing } from '../utils/path-normalization.js';

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
      `Installation target '${targetDir}' cannot point inside ${DIR_PATTERNS.OPENPACKAGE} (reserved for metadata like ${PACKAGE_PATHS.INDEX_RELATIVE}). Choose a workspace path outside metadata.`
    );
  }
}

export function validateResolutionFlags(options: InstallOptions & { local?: boolean; remote?: boolean }): void {
  if (options.remote && options.local) {
    throw new Error('--remote and --local cannot be used together. Choose one resolution mode.');
  }
}

async function installCommand(
  packageInput: string | undefined,
  options: InstallOptions
): Promise<CommandResult> {
  const targetDir = '.';
  const cwd = process.cwd();
  assertTargetDirOutsideMetadata(targetDir);
  options.resolutionMode = determineResolutionMode(options);
  logger.debug('Install resolution mode selected', { mode: options.resolutionMode });

  if (!packageInput) {
    return await runBulkInstallPipeline(options);
  }

  // Classify the input to determine if it's a registry name, directory, or tarball
  const classification = await classifyPackageInput(packageInput, cwd);
  
  // For registry-type inputs (package names), check if it's actually a path/git dependency in openpackage.yml
  // This ensures we respect the manifest's declared source type on subsequent installs
  if (classification.type === 'registry' && classification.name) {
    const existingSource = await findExistingPathOrGitSource(cwd, classification.name);
    
    if (existingSource) {
      if (existingSource.type === 'git') {
        const subdirPart = existingSource.subdirectory ? `&subdirectory=${existingSource.subdirectory}` : '';
        logger.info(`Using git source from openpackage.yml for '${classification.name}': ${existingSource.url}`);
        console.log(`✓ Using git source from openpackage.yml: ${existingSource.url}${existingSource.ref ? `#${existingSource.ref}` : ''}${subdirPart}`);
        
        const result = await loadPackageFromGit({
          url: existingSource.url,
          ref: existingSource.ref,
          subdirectory: existingSource.subdirectory
        });
        
        if (result.isMarketplace) {
          throw new ValidationError(
            `Package '${classification.name}' is declared as a git source in openpackage.yml, ` +
            `but the repository is a Claude Code plugin marketplace. ` +
            `Marketplaces cannot be used as dependencies via openpackage.yml.`
          );
        }
        
        return await runPathInstallPipeline({
          ...options,
          sourcePath: result.sourcePath,
          sourceType: 'directory',
          targetDir,
          gitUrl: existingSource.url,
          gitRef: existingSource.ref,
          gitSubdirectory: existingSource.subdirectory
        });
      } else if (existingSource.type === 'path') {
        logger.info(`Using path source from openpackage.yml for '${classification.name}': ${existingSource.path}`);
        const displayPath = formatPathForDisplay(existingSource.path, cwd);
        console.log(`✓ Using path source from openpackage.yml: ${displayPath}`);
        
        const resolvedPath = resolve(cwd, existingSource.path);
        const sourceType = inferSourceType(existingSource.path);
        return await runPathInstallPipeline({
          ...options,
          sourcePath: resolvedPath,
          sourceType,
          targetDir
        });
      }
    }
  }
  
  if (classification.type === 'git') {
    const result = await loadPackageFromGit({
      url: classification.gitUrl!,
      ref: classification.gitRef,
      subdirectory: classification.gitSubdirectory
    });
    
    // Check if this is a marketplace
    if (result.isMarketplace) {
      logger.info('Detected Claude Code marketplace, prompting for plugin selection', { 
        url: classification.gitUrl 
      });
      
      const pluginDetection = await detectPluginType(result.sourcePath);
      if (!pluginDetection.manifestPath) {
        throw new ValidationError('Marketplace manifest not found');
      }
      
      // Parse marketplace and prompt for selection
      const marketplace = await parseMarketplace(pluginDetection.manifestPath);
      const selectedPlugins = await promptPluginSelection(marketplace);
      
      if (selectedPlugins.length === 0) {
        console.log('No plugins selected. Installation cancelled.');
        return { success: true };
      }
      
      // Install selected plugins
      return await installMarketplacePlugins(
        result.sourcePath,
        marketplace,
        selectedPlugins,
        classification.gitUrl!,
        classification.gitRef,
        options
      );
    }
    
    // Not a marketplace, install as regular package/plugin
    return await runPathInstallPipeline({
      ...options,
      sourcePath: result.sourcePath,
      sourceType: 'directory',
      targetDir,
      gitUrl: classification.gitUrl,
      gitRef: classification.gitRef,
      gitSubdirectory: classification.gitSubdirectory
    });
  }

  if (classification.type === 'directory' || classification.type === 'tarball') {
    // Display source comparison info if available
    if (classification.sourceComparisonInfo) {
      displayPackageSourceResolution(classification.sourceComparisonInfo);
    }
    
    // Check if this is a marketplace (only for directories, not tarballs)
    if (classification.type === 'directory') {
      const pluginDetection = await detectPluginType(classification.resolvedPath!);
      if (pluginDetection.isPlugin && pluginDetection.type === 'marketplace') {
        logger.info('Detected Claude Code marketplace from local path, prompting for plugin selection', { 
          path: classification.resolvedPath 
        });
        
        // Parse marketplace and prompt for selection
        const marketplace = await parseMarketplace(pluginDetection.manifestPath!);
        const selectedPlugins = await promptPluginSelection(marketplace);
        
        if (selectedPlugins.length === 0) {
          console.log('No plugins selected. Installation cancelled.');
          return { success: true };
        }
        
        // Install selected plugins (no git URL for local paths)
        return await installMarketplacePlugins(
          classification.resolvedPath!,
          marketplace,
          selectedPlugins,
          classification.resolvedPath!, // Use path as "url" for tracking
          undefined, // No git ref for local paths
          options
        );
      }
    }
    
    return await runPathInstallPipeline({
      ...options,
      sourcePath: classification.resolvedPath!,
      sourceType: classification.type,
      targetDir
    });
  }
  
  // Registry-based install (existing flow)
  const { name, version, registryPath } = classification;
  return await runInstallPipeline({
    ...options,
    packageName: name!,
    version,
    registryPath,
    targetDir
  });
}

/**
 * Display user-friendly information about package source resolution
 */
function displayPackageSourceResolution(info: any): void {
  const { candidates, selected, reason } = info;
  
  // Workspace override - simple message
  if (reason === 'workspace-override') {
    console.log(`✓ Found ${selected.packageName} in workspace packages`);
    console.log(`💡 Workspace packages always override global/registry`);
    return;
  }
  
  // Single source - simple message
  if (reason === 'only-source' && candidates.length === 1) {
    const sourceType = selected.type === 'global' ? 'global packages' : 
                       selected.type === 'registry' ? 'registry' : 'workspace packages';
    console.log(`✓ Found ${selected.packageName} in ${sourceType}`);
    return;
  }
  
  // Multiple sources - show comparison
  if (candidates.length > 1) {
    console.log(`Resolving ${selected.packageName}...`);
    for (const candidate of candidates) {
      const label = candidate.type === 'global' ? 'Global packages' : 'Registry';
      const suffix = candidate.type === 'global' ? ' (mutable)' : ' (stable)';
      console.log(`  • ${label}: ${candidate.version}${suffix}`);
    }
    
    const sourceLabel = selected.type === 'global' ? 'global packages' : 'registry';
    
    if (reason === 'newer-version') {
      console.log(`✓ Using ${selected.packageName}@${selected.version} from ${sourceLabel} (newer version)`);
      
      // Warn about outdated global if registry was selected
      if (selected.type === 'registry') {
        const global = candidates.find((c: any) => c.type === 'global');
        if (global) {
          console.log(`⚠️  Global packages has older version (${global.version})`);
          console.log(`💡 To update global: cd ~/.openpackage/packages/${selected.packageName} && opkg pack`);
        }
      }
    } else if (reason === 'same-version-prefer-mutable') {
      console.log(`✓ Using ${selected.packageName}@${selected.version} from ${sourceLabel} (same version, prefer mutable)`);
    } else {
      console.log(`✓ Using ${selected.packageName}@${selected.version} from ${sourceLabel}`);
    }
  }
}

export function setupInstallCommand(program: Command): void {
  program
    .command('install')
    .alias('i')
    .description('Install packages to workspace')
    .argument('[package-name]', 'name of the package to install (optional - installs all from openpackage.yml if not specified). Supports package@version syntax.')
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
      options.platforms = normalizePlatforms(options.platforms);

      const commandOptions = options as InstallOptions & { conflicts?: string };
      const rawConflictStrategy = commandOptions.conflicts ?? options.conflictStrategy;
      if (rawConflictStrategy) {
        const normalizedStrategy = (rawConflictStrategy as string).toLowerCase();
        const allowedStrategies: InstallOptions['conflictStrategy'][] = ['keep-both', 'overwrite', 'skip', 'ask'];
        if (!allowedStrategies.includes(normalizedStrategy as InstallOptions['conflictStrategy'])) {
          throw new Error(`Invalid --conflicts value '${rawConflictStrategy}'. Use one of: keep-both, overwrite, skip, ask.`);
        }
        options.conflictStrategy = normalizedStrategy as InstallOptions['conflictStrategy'];
      }

      validateResolutionFlags(options);
      options.resolutionMode = determineResolutionMode(options);

      const result = await installCommand(packageName, options);
      if (!result.success) {
        if (result.error === 'Package not found') {
          return;
        }
        throw new Error(result.error || 'Installation operation failed');
      }
    }));
}

