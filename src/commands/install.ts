import { Command } from 'commander';

import type { CommandResult, InstallOptions } from '../types/index.js';
import { DIR_PATTERNS, PACKAGE_PATHS } from '../constants/index.js';
import { runBulkInstallPipeline } from '../core/install/bulk-install-pipeline.js';
import { runInstallPipeline, determineResolutionMode } from '../core/install/install-pipeline.js';
import { runPathInstallPipeline } from '../core/install/path-install-pipeline.js';
import { loadPackageFromGit } from '../core/install/git-package-loader.js';
import { withErrorHandling } from '../utils/errors.js';
import { normalizePlatforms } from '../utils/platform-mapper.js';
import { classifyPackageInput } from '../utils/package-input.js';
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
  
  if (classification.type === 'git') {
    const { sourcePath } = await loadPackageFromGit({
      url: classification.gitUrl!,
      ref: classification.gitRef
    });
    return await runPathInstallPipeline({
      ...options,
      sourcePath,
      sourceType: 'directory',
      targetDir,
      gitUrl: classification.gitUrl,
      gitRef: classification.gitRef
    });
  }

  if (classification.type === 'directory' || classification.type === 'tarball') {
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

export function setupInstallCommand(program: Command): void {
  program
    .command('install')
    .alias('i')
    .description(
      'Install packages from the local (and optional remote) registry into this workspace. Works with WIP copies from `opkg save` and stable releases from `opkg pack`.'
    )
    .argument('[package-name]', 'name of the package to install (optional - installs all from package.yml if not specified). Supports package@version syntax.')
    .option('--dry-run', 'preview changes without applying them')
    .option('--force', 'overwrite existing files')
    .option('--conflicts <strategy>', 'conflict handling strategy: keep-both, overwrite, skip, or ask')
    .option('--dev', 'add package to dev-packages instead of packages')
    .option('--platforms <platforms...>', 'prepare specific platforms (e.g., cursor claudecode opencode)')
    .option('--remote', 'pull and install from remote registry, ignoring local versions')
    .option('--local', 'resolve and install using only local registry versions, skipping remote metadata and pulls')
    .option('--stable', 'prefer the latest stable version when resolving; ignore newer prerelease/WIP versions if a satisfying stable exists')
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

