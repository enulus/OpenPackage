import { join } from 'path';

import type { AddInputClassification } from './add-input-classifier.js';
import type { PackageDependency } from '../../types/index.js';
import { resolveMutableSource } from '../source-resolution/resolve-mutable-source.js';
import { addPackageToYml, ensureLocalOpenPackageStructure, createWorkspacePackageYml } from '../../utils/package-management.js';
import { parsePackageYml, writePackageYml } from '../../utils/package-yml.js';
import { normalizePackageName, arePackageNamesEquivalent } from '../../utils/package-name.js';
import { formatPathForYaml } from '../../utils/path-resolution.js';
import { getLocalPackageYmlPath } from '../../utils/paths.js';
import { exists } from '../../utils/fs.js';
import { FILE_PATTERNS } from '../../constants/index.js';
import { logger } from '../../utils/logger.js';

export interface AddDependencyOptions {
  dev?: boolean;
  to?: string;
}

export interface AddDependencyResult {
  packageName: string;
  targetManifest: string;
  section: 'dependencies' | 'dev-dependencies';
  isLocalPath: boolean;
  wasAutoDetected: boolean;
}

export async function runAddDependencyFlow(
  classification: AddInputClassification,
  options: AddDependencyOptions
): Promise<AddDependencyResult> {
  const cwd = process.cwd();
  const isDev = options.dev ?? false;
  const section = isDev ? 'dev-dependencies' : 'dependencies';
  const packageName = classification.packageName!;
  const isLocalPath = !!classification.localPath;

  const localPath = classification.localPath
    ? formatPathForYaml(classification.localPath, cwd)
    : undefined;

  let gitUrl: string | undefined;
  if (classification.gitUrl) {
    gitUrl = classification.gitRef
      ? `${classification.gitUrl}#${classification.gitRef}`
      : classification.gitUrl;
  }

  const gitPath = classification.gitPath || classification.resourcePath;

  if (options.to) {
    const source = await resolveMutableSource({ cwd, packageName: options.to });
    const manifestPath = join(source.absolutePath, FILE_PATTERNS.OPENPACKAGE_YML);

    await addDependencyToManifest(manifestPath, packageName, {
      version: classification.version,
      path: localPath,
      url: gitUrl,
      gitPath,
      isDev,
    });

    logger.info(`Added ${packageName} to ${manifestPath} [${section}]`);

    return {
      packageName,
      targetManifest: manifestPath,
      section,
      isLocalPath,
      wasAutoDetected: isLocalPath,
    };
  }

  const packageYmlPath = getLocalPackageYmlPath(cwd);
  if (!(await exists(packageYmlPath))) {
    await ensureLocalOpenPackageStructure(cwd);
    await createWorkspacePackageYml(cwd);
  }

  await addPackageToYml(
    cwd,
    packageName,
    classification.version,
    isDev,
    undefined,
    false,
    localPath,
    classification.gitUrl,
    classification.gitRef,
    gitPath,
    undefined
  );

  logger.info(`Added ${packageName} to workspace manifest [${section}]`);

  return {
    packageName,
    targetManifest: packageYmlPath,
    section,
    isLocalPath,
    wasAutoDetected: isLocalPath,
  };
}

async function addDependencyToManifest(
  manifestPath: string,
  packageName: string,
  options: {
    version?: string;
    path?: string;
    url?: string;
    gitPath?: string;
    isDev: boolean;
  }
): Promise<void> {
  const config = await parsePackageYml(manifestPath);
  if (!config.dependencies) config.dependencies = [];
  if (!config['dev-dependencies']) config['dev-dependencies'] = [];

  const normalized = normalizePackageName(packageName);

  const dependency: PackageDependency = {
    name: normalized,
    ...(options.url ? { url: options.url } : {}),
    ...(options.path && !options.url ? { path: options.path } : {}),
    ...(options.version && !options.url && !options.path ? { version: options.version } : {}),
    ...(options.gitPath && options.url ? { path: options.gitPath } : {}),
  };

  const targetKey = options.isDev ? 'dev-dependencies' : 'dependencies';
  const otherKey = options.isDev ? 'dependencies' : 'dev-dependencies';

  const otherArr = config[otherKey]!;
  const otherIdx = otherArr.findIndex(d => arePackageNamesEquivalent(d.name, normalized));
  if (otherIdx >= 0) {
    otherArr.splice(otherIdx, 1);
  }

  const targetArr = config[targetKey]!;
  const existingIdx = targetArr.findIndex(d => arePackageNamesEquivalent(d.name, normalized));
  if (existingIdx >= 0) {
    targetArr[existingIdx] = dependency;
  } else {
    targetArr.push(dependency);
  }

  await writePackageYml(manifestPath, config);
}
