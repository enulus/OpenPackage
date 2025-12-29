import { CommandResult, PackageFile } from '../../types/index.js';
import { PACKAGE_PATHS, UNVERSIONED } from '../../constants/index.js';
import { ensureRegistryDirectories } from '../directory.js';
import { logger } from '../../utils/logger.js';
import { addPackageToYml, createWorkspacePackageYml, isPathBasedDependency } from '../../utils/package-management.js';
import { performPlatformSync, PlatformSyncResult } from '../sync/platform-sync.js';
import { LOG_PREFIXES, ERROR_MESSAGES, MODE_LABELS } from './constants.js';
import { isPackageTransitivelyCovered } from '../../utils/dependency-coverage.js';
import { readPackageIndex, writePackageIndex } from '../../utils/package-index-yml.js';
import { createWorkspaceHash, createWorkspaceTag } from '../../utils/version-generator.js';
import { computeWipVersion, computePackTargetVersion } from './save-versioning.js';
import { savePackageToRegistry } from './package-saver.js';
import { isUnversionedVersion, packageVersionExists } from '../../utils/package-versioning.js';
import { deleteWorkspaceWipCopies } from './workspace-wip-cleanup.js';
import { writePackageYml } from '../../utils/package-yml.js';
import { printPlatformSyncSummary } from '../sync/platform-sync-summary.js';
import { resolveWorkspaceNames, SaveMode } from './name-resolution.js';
import { resolvePackageFilesWithConflicts } from './save-conflict-resolution.js';
import { getDetectedPlatforms, type Platform } from '../platforms.js';
import { buildIndexMappingForPackageFiles, loadOtherPackageIndexes } from '../../utils/index-based-installer.js';
import { getPackageIndexPath } from '../../utils/package-index-yml.js';
import { 
  detectPackageContext, 
  getNoPackageDetectedMessage,
  getPackageYmlPath,
  getPackageFilesDir,
  getPackageRootDir,
  type PackageContext 
} from '../package-context.js';
import { applyWorkspacePackageRename } from './workspace-rename.js';

export type { SaveMode } from './name-resolution.js';

export interface SavePipelineOptions {
  mode: SaveMode;
  force?: boolean;
  rename?: string;
  apply?: boolean;
}

export interface SavePipelineResult {
  config: { name: string; version: string };
  packageFiles: PackageFile[];
  syncResult?: PlatformSyncResult;
}

export async function runSavePipeline(
  packageName: string | undefined,
  options: SavePipelineOptions
): Promise<CommandResult<SavePipelineResult | { packageFiles: PackageFile[] }>> {
  const cwd = process.cwd();
  const { mode, force, rename, apply = false } = options;
  const { op, opCap } = MODE_LABELS[mode];

  // Use unified detection
  const detectedContext = await detectPackageContext(cwd, packageName);
  if (!detectedContext) {
    return { success: false, error: getNoPackageDetectedMessage(packageName) };
  }

  await createWorkspacePackageYml(cwd);
  await ensureRegistryDirectories();

  const packageInput = packageName ?? detectedContext.config.name;
  const nameResolution = await resolveWorkspaceNames(packageInput, rename, mode);

  if (nameResolution.renameReason === 'scoping' && nameResolution.needsRename) {
    console.log(`✓ Using scoped package name '${nameResolution.finalName}' for ${op} operation`);
  }

  // Build PackageContext directly
  let packageContext: PackageContext = { ...detectedContext };

  if (nameResolution.needsRename) {
    await applyWorkspacePackageRename(cwd, packageContext, nameResolution.finalName);

    // For root packages, packageYmlPath stays the same
    // For nested packages, it moves to the new name's location
    const updatedPackageYmlPath = packageContext.location === 'root'
      ? packageContext.packageYmlPath
      : getPackageYmlPath(cwd, 'nested', nameResolution.finalName);
    
    const updatedPackageFilesDir = packageContext.location === 'root'
      ? packageContext.packageFilesDir
      : getPackageFilesDir(cwd, 'nested', nameResolution.finalName);

    const updatedPackageRootDir = packageContext.location === 'root'
      ? packageContext.packageRootDir
      : getPackageRootDir(cwd, 'nested', nameResolution.finalName);

    packageContext = {
      ...packageContext,
      name: nameResolution.finalName,
      packageYmlPath: updatedPackageYmlPath,
      packageFilesDir: updatedPackageFilesDir,
      packageRootDir: updatedPackageRootDir,
      config: { ...packageContext.config, name: nameResolution.finalName }
    };
  }

  const indexRecord = await readPackageIndex(cwd, packageContext.config.name, packageContext.location);
  const workspaceHash = createWorkspaceHash(cwd);
  const workspaceTag = createWorkspaceTag(cwd);

  const baseVersion = packageContext.config.version;
  const isUnversioned = isUnversionedVersion(baseVersion);

  let targetVersion: string;
  let shouldBumpPackageYml = false;
  let nextStable: string | undefined;

  if (isUnversioned) {
    if (mode === 'stable') {
      throw new Error('openpackage.yml must contain a semver version to pack a release.');
    }
    targetVersion = UNVERSIONED;
  } else if (mode === 'wip') {
    const stableBase = baseVersion as string;
    const wipInfo = computeWipVersion(
      stableBase,
      indexRecord?.workspace?.version,
      cwd
    );
    if (wipInfo.resetMessage) console.log(wipInfo.resetMessage);
    targetVersion = wipInfo.wipVersion;
    shouldBumpPackageYml = wipInfo.shouldBumpPackageYml;
    nextStable = wipInfo.nextStable;
  } else {
    const stableBase = baseVersion as string;
    const packInfo = computePackTargetVersion(
      stableBase,
      indexRecord?.workspace?.version
    );
    if (packInfo.resetMessage) console.log(packInfo.resetMessage);
    targetVersion = packInfo.targetVersion;
  }

  if (mode === 'wip' && shouldBumpPackageYml && nextStable) {
    try {
      const bumpedConfig = { ...packageContext.config, version: nextStable };
      await writePackageYml(packageContext.packageYmlPath, bumpedConfig);
      packageContext = { ...packageContext, config: bumpedConfig, version: nextStable };
      console.log(`✓ Updated openpackage.yml.version to ${nextStable} for the next cycle`);
    } catch (error) {
      logger.warn(`Failed to auto-bump openpackage.yml before save: ${String(error)}`);
    }
  }

  if (mode === 'stable' && !force) {
    const exists = await packageVersionExists(packageContext.config.name, targetVersion);
    if (exists) {
      throw new Error(ERROR_MESSAGES.VERSION_EXISTS.replace('%s', targetVersion));
    }
  }

  const effectiveConfig = { ...packageContext.config, version: targetVersion };
  const packageFiles = (await resolvePackageFilesWithConflicts(packageContext, { force })).filter(
    file => file.path !== PACKAGE_PATHS.INDEX_RELATIVE
  );

  const registrySave = await savePackageToRegistry(
    { ...packageContext, config: effectiveConfig },
    packageFiles
  );
  if (!registrySave.success) {
    return { success: false, error: registrySave.error || `${opCap} operation failed` };
  }

  await deleteWorkspaceWipCopies(
    effectiveConfig.name,
    workspaceTag,
    mode === 'wip' ? { keepVersion: targetVersion } : undefined
  );

  let syncResult: PlatformSyncResult | undefined;

  if (apply) {
    syncResult = await performPlatformSync(
      cwd,
      effectiveConfig.name,
      effectiveConfig.version,
      packageFiles,
      {
        force,
        conflictStrategy: force ? 'overwrite' : 'ask',
        skipRootSync: packageContext.location === 'root',
        packageLocation: packageContext.location
      }
    );
  }

  // Always write/update the workspace-local package index on save (wip or stable).
  // The index records concrete workspace paths that exist today; apply/install will expand it later.
  try {
    const detectedPlatforms: Platform[] = await getDetectedPlatforms(cwd);
    const otherIndexes = await loadOtherPackageIndexes(cwd, effectiveConfig.name);
    const mapping = await buildIndexMappingForPackageFiles(
      cwd,
      packageFiles,
      detectedPlatforms,
      indexRecord,
      otherIndexes
    );

    await writePackageIndex({
      path: getPackageIndexPath(cwd, effectiveConfig.name, packageContext.location),
      packageName: effectiveConfig.name,
      workspace: { hash: workspaceHash, version: effectiveConfig.version },
      files: mapping
    });
  } catch (error) {
    logger.warn(`Failed to update openpackage.index.yml for ${effectiveConfig.name}: ${String(error)}`);
  }

  if (packageContext.location !== 'root') {
    // Skip saving path-based dependencies - they're linked, not copied
    const isPathBased = await isPathBasedDependency(cwd, effectiveConfig.name);
    if (isPathBased) {
      console.log(`ℹ️  Skipping '${effectiveConfig.name}' (linked from path)`);
      return {
        success: true,
        data: {
          config: effectiveConfig,
          packageFiles,
          syncResult
        }
      };
    }

    const covered = await isPackageTransitivelyCovered(cwd, effectiveConfig.name);
    if (!covered) {
      const versionForYml = isUnversioned ? undefined : effectiveConfig.version;
      await addPackageToYml(
        cwd,
        effectiveConfig.name,
        versionForYml,
        false,
        undefined,
        true
      );
    } else {
      logger.debug(`Skipping addition of ${effectiveConfig.name} to openpackage.yml; already covered transitively.`);
    }
  }

  if (mode === 'stable' && indexRecord) {
    await writePackageIndex({
      ...indexRecord,
      workspace: { hash: workspaceHash, version: effectiveConfig.version }
    });
  }

  printPlatformSyncSummary({
    actionLabel: LOG_PREFIXES.SAVED.replace(/^✓\s*/, ''),
    packageContext,
    version: effectiveConfig.version,
    packageFiles,
    syncResult: apply ? syncResult : undefined,
    noSyncHint: apply
      ? undefined
      : 'ℹ️  Apply skipped. Run `opkg apply` or `opkg save --apply` to sync platforms.'
  });

  return {
    success: true,
    data: { config: effectiveConfig, packageFiles, syncResult }
  };
}
