/**
 * Interactive Unpublish Flow
 *
 * Orchestration logic for the interactive unpublish workflow:
 * list packages → select versions → confirm → execute.
 * Uses OutputPort/PromptPort for all user interaction so it can
 * be driven by CLI, GUI, or tests.
 */

import type { UnpublishOptions } from './unpublish-types.js';
import { runUnpublishPipeline } from './unpublish-pipeline.js';
import {
  listAllPackages,
  listPackageVersions,
  getPackageVersionPath,
  findPackageByName,
} from '../directory.js';
import { getDirectorySize, countFilesInDirectory } from '../../utils/fs.js';
import { formatFileSize, formatFileCount } from '../../utils/formatters.js';
import { normalizePackageName } from '../../utils/package-name.js';
import type { OutputPort } from '../ports/output.js';
import type { PromptPort } from '../ports/prompt.js';
import { PackageNotFoundError, UserCancellationError, ValidationError } from '../../utils/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InteractiveUnpublishResult {
  unpublishedVersions: string[];
  packageName: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers (pure string transforms, no terminal deps)
// ---------------------------------------------------------------------------

function formatPackageChoice(name: string, versionCount: number): string {
  return `${name} (${versionCount} version${versionCount === 1 ? '' : 's'})`;
}

function formatVersionChoice(version: string, fileCount: number, size: string): string {
  return `${version} (${formatFileCount(fileCount)}, ${size})`;
}

// ---------------------------------------------------------------------------
// Selection flows
// ---------------------------------------------------------------------------

/**
 * Present user with a list of all published packages and let them pick one.
 */
export async function selectPackageFromList(
  out: OutputPort,
  prm: PromptPort
): Promise<string> {
  const packages = await listAllPackages();
  if (packages.length === 0) {
    throw new ValidationError('No published packages found.');
  }

  const choices = await Promise.all(
    packages.map(async (name) => {
      const versions = await listPackageVersions(name);
      return {
        title: formatPackageChoice(name, versions.length),
        value: name,
      };
    })
  );

  return prm.select<string>('Select a package to unpublish:', choices);
}

/**
 * Present user with a list of versions for a package and let them pick.
 */
export async function selectVersionsFromPackage(
  packageName: string,
  out: OutputPort,
  prm: PromptPort
): Promise<string[]> {
  const versions = await listPackageVersions(packageName);
  if (versions.length === 0) {
    throw new ValidationError(`No versions found for ${packageName}.`);
  }

  const choices = await Promise.all(
    versions.map(async (version) => {
      const versionPath = getPackageVersionPath(packageName, version);
      const [fileCount, size] = await Promise.all([
        countFilesInDirectory(versionPath),
        getDirectorySize(versionPath).then(formatFileSize),
      ]);
      return {
        title: formatVersionChoice(version, fileCount, size),
        value: version,
      };
    })
  );

  return prm.multiselect<string>(
    `Select versions of ${packageName} to unpublish:`,
    choices
  );
}

// ---------------------------------------------------------------------------
// Full interactive flow
// ---------------------------------------------------------------------------

/**
 * Run the full interactive unpublish workflow:
 * 1. Resolve or prompt for package name
 * 2. Prompt for version selection
 * 3. Confirm and execute
 *
 * Returns which versions were unpublished.
 */
export async function runInteractiveUnpublishFlow(
  packageSpec: string | undefined,
  options: UnpublishOptions,
  out: OutputPort,
  prm: PromptPort
): Promise<InteractiveUnpublishResult> {
  // Step 1: Resolve package name
  let packageName: string;
  if (packageSpec) {
    const normalized = normalizePackageName(packageSpec);
    const found = await findPackageByName(normalized);
    if (!found) {
      throw new PackageNotFoundError(normalized);
    }
    packageName = normalized;
  } else {
    packageName = await selectPackageFromList(out, prm);
  }

  // Step 2: Select versions
  const selectedVersions = await selectVersionsFromPackage(packageName, out, prm);
  if (selectedVersions.length === 0) {
    throw new UserCancellationError();
  }

  // Step 3: Confirm
  const confirmMsg =
    selectedVersions.length === 1
      ? `Unpublish ${packageName}@${selectedVersions[0]}?`
      : `Unpublish ${selectedVersions.length} versions of ${packageName}?`;

  const confirmed = await prm.confirm(confirmMsg);
  if (!confirmed) {
    throw new UserCancellationError();
  }

  // Step 4: Execute
  const unpublishedVersions: string[] = [];
  for (const version of selectedVersions) {
    const spec = `${packageName}@${version}`;
    const result = await runUnpublishPipeline(spec, { ...options, local: true });
    if (result.success) {
      unpublishedVersions.push(version);
      out.success(`Unpublished ${spec}`);
    } else {
      out.error(`Failed to unpublish ${spec}: ${result.error}`);
    }
  }

  return { unpublishedVersions, packageName };
}
