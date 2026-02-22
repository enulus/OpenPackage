import * as clack from '@clack/prompts';
import { basename } from 'path';
import { PackageYml } from '@opkg/core/types/index.js';
import { UserCancellationError } from '@opkg/core/utils/errors.js';
import type { PlatformDefinition } from '@opkg/core/types/platform.js';
import { getPlatformDefinitions } from '@opkg/core/core/platforms.js';
import { normalizePackageName, validatePackageName } from '@opkg/core/utils/package-name.js';
import { readTextFile } from '@opkg/core/utils/fs.js';
import { formatPathForDisplay } from '@opkg/core/utils/formatters.js';

/**
 * Common prompt types and utilities for user interaction.
 *
 * All prompts are backed by @clack/prompts. The `prompts` npm package
 * is no longer used anywhere in the codebase.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function handleCancel(result: unknown): void {
  if (clack.isCancel(result)) {
    clack.cancel('Operation cancelled.');
    throw new UserCancellationError('Operation cancelled by user');
  }
}

// ---------------------------------------------------------------------------
// Confirmation helpers
// ---------------------------------------------------------------------------

/**
 * Prompt for simple confirmation
 */
export async function promptConfirmation(message: string, initial: boolean = false): Promise<boolean> {
  const result = await clack.confirm({ message, initialValue: initial });
  handleCancel(result);
  return result as boolean;
}

/**
 * Prompt for overwrite confirmation with specific package context
 */
export async function promptPackageOverwrite(packageName: string, existingVersion?: string): Promise<boolean> {
  const versionSuffix = existingVersion ? ` (${existingVersion})` : '';
  return await promptConfirmation(
    `Package '${packageName}' already exists${versionSuffix}. Overwrite all files?`,
    false
  );
}

/**
 * Prompt for pack overwrite confirmation with detailed context
 */
export async function promptPackOverwrite(
  packageName: string,
  version: string,
  destination: string,
  existingFileCount: number,
  isCustomOutput: boolean
): Promise<boolean> {
  const locationType = isCustomOutput ? 'output directory' : 'registry';
  const displayPath = formatPathForDisplay(destination, process.cwd());

  clack.log.warn(
    `Package '${packageName}@${version}' already exists in ${locationType}\n` +
    `   Location: ${displayPath}\n` +
    `   Existing files: ${existingFileCount}`
  );

  return await promptConfirmation(
    `Overwrite '${packageName}@${version}'? This action cannot be undone.`,
    false
  );
}

/**
 * Prompt for package deletion confirmation
 */
export async function promptPackageDelete(packageName: string): Promise<boolean> {
  return await promptConfirmation(
    `Are you sure you want to delete package '${packageName}'? This action cannot be undone.`,
    false
  );
}

/**
 * Prompt for unpublishing all versions of a package
 */
export async function promptUnpublishConfirmation(
  packageName: string,
  versions: string[]
): Promise<boolean> {
  return await promptConfirmation(
    `Unpublish ALL ${versions.length} versions of '${packageName}'? This action cannot be undone.`,
    false
  );
}

/**
 * Prompt for creating a new package
 */
export async function promptCreatePackage(): Promise<boolean> {
  return await promptConfirmation(
    'No openpackage.yml found. Would you like to create a new package?',
    true
  );
}

// ---------------------------------------------------------------------------
// Text / name prompts
// ---------------------------------------------------------------------------

/**
 * Prompt user to enter a package name
 */
export async function promptPackageName(
  defaultName?: string,
  existsChecker?: (name: string) => Promise<boolean>
): Promise<string> {
  const cwd = process.cwd();
  const suggestedName = defaultName || basename(cwd);

  const result = await clack.text({
    message: 'Package name:',
    defaultValue: suggestedName,
    validate: (async (value: string | undefined) => {
      if (!value) return 'Name is required';
      try {
        validatePackageName(value);
      } catch (error) {
        const message = (error as Error).message;
        return message.replace(/^Validation error:\s*/, '');
      }

      if (existsChecker) {
        const normalized = normalizePackageName(value);
        const alreadyExists = await existsChecker(normalized);
        if (alreadyExists) {
          return `Package '${normalized}' already exists. Please choose a different name.`;
        }
      }
      return undefined;
    }) as any,
  });
  handleCancel(result);
  return normalizePackageName(result as string);
}

/**
 * Package details prompt for interactive package creation
 */
export async function promptPackageDetails(
  defaultName?: string,
  existsChecker?: (name: string) => Promise<boolean>
): Promise<PackageYml> {
  const name = await promptPackageName(defaultName, existsChecker);

  const description = await clack.text({ message: 'Description:', defaultValue: '' });
  handleCancel(description);

  const keywords = await clack.text({ message: 'Keywords (space-separated):', defaultValue: '' });
  handleCancel(keywords);

  const isPrivate = await clack.confirm({ message: 'Private package?', initialValue: false });
  handleCancel(isPrivate);

  const keywordsArray = (keywords as string)
    ? (keywords as string).trim().split(/\s+/).filter((k: string) => k.length > 0)
    : [];

  const config: PackageYml = {
    name: normalizePackageName(name),
    ...((description as string) && { description: description as string }),
    ...(keywordsArray.length > 0 && { keywords: keywordsArray }),
    ...(isPrivate && { private: isPrivate as boolean })
  };

  return config;
}

/**
 * Package details prompt for named package creation (skips name prompt)
 */
export async function promptPackageDetailsForNamed(packageName: string): Promise<PackageYml> {
  const description = await clack.text({ message: 'Description:', defaultValue: '' });
  handleCancel(description);

  const keywords = await clack.text({ message: 'Keywords (space-separated):', defaultValue: '' });
  handleCancel(keywords);

  const isPrivate = await clack.confirm({ message: 'Private package?', initialValue: false });
  handleCancel(isPrivate);

  const keywordsArray = (keywords as string)
    ? (keywords as string).trim().split(/\s+/).filter((k: string) => k.length > 0)
    : [];

  const config: PackageYml = {
    name: normalizePackageName(packageName),
    ...((description as string) && { description: description as string }),
    ...(keywordsArray.length > 0 && { keywords: keywordsArray }),
    ...(isPrivate && { private: isPrivate as boolean })
  };

  return config;
}

/**
 * Handle cancellation result from prompts
 */
export function isCancelled(result: any): boolean {
  return result === undefined || clack.isCancel(result);
}

// ---------------------------------------------------------------------------
// Version prompts
// ---------------------------------------------------------------------------

/**
 * Prompt user to enter a new version number
 */
export async function promptNewVersion(packageName: string, versionContext: string): Promise<string> {
  const currentVersionMatch = versionContext.match(/current: ([^,)]+)/);
  const currentVersion = currentVersionMatch ? currentVersionMatch[1] : versionContext;

  const result = await clack.text({
    message: `Enter a new version for '${packageName}' (${versionContext}):`,
    defaultValue: currentVersion,
    validate: (value: string | undefined) => {
      if (!value) return 'Version is required';
      if (!/^\d+\.\d+\.\d+/.test(value)) {
        return 'Version should follow semantic versioning (e.g., 1.0.0)';
      }
      if (value === currentVersion) {
        return 'New version must be different from current version';
      }
      return undefined;
    },
  });
  handleCancel(result);
  return result as string;
}

/**
 * Prompt user to confirm version overwrite
 */
export async function promptVersionOverwrite(packageName: string, oldVersion: string, newVersion: string): Promise<boolean> {
  return await promptConfirmation(
    `Overwrite package '${packageName}' version ${oldVersion} with version ${newVersion}?`,
    false
  );
}

// ---------------------------------------------------------------------------
// Select / multiselect prompts
// ---------------------------------------------------------------------------

/**
 * Prompt user to select platform they're using
 */
export async function promptPlatformSelection(): Promise<string[]> {
  const options = Object.values(getPlatformDefinitions()).map((platform: PlatformDefinition) => ({
    label: platform.name,
    value: platform.id,
  }));

  const result = await clack.select({ message: 'Which platform are you using for AI-assisted development?', options });
  handleCancel(result);

  return result ? [result as string] : [];
}

/**
 * Prompt for version selection from available versions
 */
export async function promptVersionSelection(
  packageName: string,
  versions: string[],
  action: string = ''
): Promise<string> {
  const options = versions.map(version => ({ label: version, value: version }));
  const result = await clack.select({
    message: `Select version of '${packageName}' ${action}:`,
    options,
  });
  handleCancel(result);
  return result as string;
}

/**
 * Prompt user for package installation conflict resolution
 */
export async function promptPackageInstallConflict(
  packageName: string,
  existingVersion: string,
  newVersion: string,
  requiredVersion?: string
): Promise<'keep' | 'latest' | 'exact'> {
  const exactVersion = requiredVersion || newVersion;
  const exactDescription = requiredVersion
    ? `Install version ${exactVersion} as required by dependency tree`
    : `Install version ${exactVersion}, may be older than current`;

  const result = await clack.select({
    message: `Package '${packageName}' already installed. How would you like to proceed?`,
    options: [
      {
        label: 'Keep installed - Skip installation',
        value: 'keep' as const,
        hint: 'Keep the currently installed version',
      },
      {
        label: 'Install latest - Overwrite',
        value: 'latest' as const,
        hint: 'Install the latest version, overwriting existing',
      },
      {
        label: `Install exact (v${exactVersion}) - Overwrite with specific version`,
        value: 'exact' as const,
        hint: exactDescription,
      },
    ],
  });
  handleCancel(result);
  return result as 'keep' | 'latest' | 'exact';
}

/**
 * Prompt user for version conflict resolution when saving
 */
export async function promptVersionConflictResolution(
  packageName: string,
  existingVersion: string
): Promise<'bump-patch' | 'bump-minor' | 'overwrite'> {
  const result = await clack.select({
    message: `Version '${existingVersion}' of package '${packageName}' already exists. How would you like to proceed?`,
    options: [
      {
        label: `Bump patch (${existingVersion} -> ${bumpPatchVersion(existingVersion)})`,
        value: 'bump-patch' as const,
        hint: 'Increment the patch version for bug fixes',
      },
      {
        label: `Bump minor (${existingVersion} -> ${bumpMinorVersion(existingVersion)})`,
        value: 'bump-minor' as const,
        hint: 'Increment the minor version for new features',
      },
      {
        label: 'Overwrite existing - Replace existing version',
        value: 'overwrite' as const,
        hint: 'Replace the existing version (requires confirmation)',
      },
    ],
  });
  handleCancel(result);
  return result as 'bump-patch' | 'bump-minor' | 'overwrite';
}

/**
 * Prompt user to confirm overwrite with double confirmation
 */
export async function promptOverwriteConfirmation(
  packageName: string,
  version: string
): Promise<boolean> {
  return await promptConfirmation(
    `Are you sure you want to overwrite version '${version}' of package '${packageName}'? This action cannot be undone.`,
    false
  );
}

// ---------------------------------------------------------------------------
// Internal version helpers
// ---------------------------------------------------------------------------

function bumpPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length >= 3) {
    const patch = parseInt(parts[2], 10) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }
  return version;
}

function bumpMinorVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length >= 2) {
    const minor = parseInt(parts[1], 10) + 1;
    return `${parts[0]}.${minor}.0`;
  }
  return version;
}

// ---------------------------------------------------------------------------
// Platform-specific file selection
// ---------------------------------------------------------------------------

interface FileSelectionOption {
  platform: string;
  sourcePath: string;
  registryPath: string;
}

/**
 * Prompt user to mark multiple files as platform-specific
 */
export async function promptPlatformSpecificSelection(
  options: FileSelectionOption[],
  message: string = 'Select files to mark as platform-specific (they will keep their platform prefixes):',
  _hint?: string
): Promise<number[]> {
  const clackOptions = options.map((option, index) => ({
    label: `${option.platform}: ${option.registryPath}`,
    value: index,
  }));

  const result = await clack.multiselect({
    message,
    options: clackOptions,
    required: false,
  });
  handleCancel(result);
  return (result as number[]) || [];
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Get preview of file content (first few lines)
 */
export async function getContentPreview(filePath: string, maxLines: number = 3): Promise<string> {
  try {
    const content = await readTextFile(filePath);
    const lines = content.split('\n').slice(0, maxLines);
    return lines.join('\n').substring(0, 100) + (lines.length >= maxLines ? '...' : '');
  } catch {
    return '[Unable to read preview]';
  }
}

/**
 * Display a multiselect prompt
 */
export async function promptMultiselect<T = string>(
  message: string,
  choices: Array<{ title: string; value: T; description?: string }>,
  options?: { hint?: string; min?: number }
): Promise<T[]> {
  const clackOptions = choices.map(c => ({
    label: c.title,
    value: c.value,
    hint: c.description,
  }));

  const result = await clack.multiselect({
    message,
    options: clackOptions as any,
    required: options?.min ? options.min > 0 : false,
  });
  handleCancel(result);
  return (result as T[]) || [];
}

/**
 * Display a select prompt
 */
export async function promptSelect<T = string>(
  message: string,
  choices: Array<{ title: string; value: T; description?: string }>,
  _options?: { hint?: string }
): Promise<T | null> {
  const clackOptions = choices.map(c => ({
    label: c.title,
    value: c.value,
    hint: c.description,
  }));

  const result = await clack.select({
    message,
    options: clackOptions as any,
  });
  handleCancel(result);
  return (result as T) ?? null;
}
