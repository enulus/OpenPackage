import path from 'path';
import { Command } from 'commander';
import { outro, cancel, note, spinner } from '@clack/prompts';

import type { UninstallOptions, ExecutionContext } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { runUninstallPipeline, runSelectiveUninstallPipeline } from '../core/uninstall/uninstall-pipeline.js';
import { reportUninstallResult, reportResourceUninstallResult } from '../core/uninstall/uninstall-reporter.js';
import { createExecutionContext } from '../core/execution-context.js';
import { remove, exists } from '../utils/fs.js';
import { buildWorkspaceResources, type ResolvedResource, type ResolvedPackage } from '../core/resources/resource-builder.js';
import { resolveByName, type ResolutionCandidate } from '../core/resources/resource-resolver.js';
import { traverseScopes, traverseScopesFlat } from '../core/resources/scope-traversal.js';
import { disambiguate } from '../core/resources/disambiguation-prompt.js';
import { buildPreservedDirectoriesSet } from '../utils/directory-preservation.js';
import { cleanupEmptyParents } from '../utils/cleanup-empty-parents.js';
import { formatScopeTag } from '../utils/formatters.js';
import { clackGroupMultiselect } from '../utils/clack-multiselect.js';

interface UninstallCommandOptions extends UninstallOptions {
  list?: boolean;
}

async function uninstallCommand(
  nameArg: string | undefined,
  options: UninstallCommandOptions,
  command: Command
) {
  const programOpts = command.parent?.opts() || {};

  if (options.list) {
    await handleListUninstall(nameArg, options, programOpts);
    return;
  }

  if (!nameArg) {
    throw new ValidationError('Resource or package name is required. Use --list to interactively select.');
  }

  await handleDirectUninstall(nameArg, options, programOpts);
}

// ---------------------------------------------------------------------------
// Direct uninstall: opkg un <name>
// ---------------------------------------------------------------------------

async function handleDirectUninstall(
  name: string,
  options: UninstallCommandOptions,
  programOpts: Record<string, any>
) {
  const candidates = await traverseScopesFlat<ResolutionCandidate>(
    { programOpts, globalOnly: options.global },
    async ({ scope, context }) => {
      const result = await resolveByName(name, context.targetDir, scope);
      return result.candidates;
    }
  );

  const selected = await disambiguate(
    name,
    candidates,
    (c) => ({
      title: formatCandidateTitle(c),
      description: formatCandidateDescription(c),
      value: c,
    }),
    {
      notFoundMessage: `"${name}" not found as a resource or package.\nRun \`opkg ls\` to see installed resources.`,
      promptMessage: 'Select which to uninstall:',
    }
  );

  if (selected.length === 0) {
    cancel('Uninstall cancelled');
    return;
  }

  for (const candidate of selected) {
    const ctx = await createExecutionContext({
      global: candidate.resource?.scope === 'global' || candidate.package?.scope === 'global',
      cwd: programOpts.cwd,
    });
    await executeCandidate(candidate, options, ctx);
  }
  
  outro('Uninstall complete');
}

// ---------------------------------------------------------------------------
// Interactive list: opkg un --list [package-name]
// ---------------------------------------------------------------------------

async function handleListUninstall(
  packageFilter: string | undefined,
  options: UninstallCommandOptions,
  programOpts: Record<string, any>
) {
  // Build resources from applicable scopes with spinner
  const s = spinner();
  s.start('Loading installed resources');
  
  const scopeResults = await traverseScopes(
    { programOpts, globalOnly: options.global },
    async ({ scope, context }) => buildWorkspaceResources(context.targetDir, scope)
  );

  const allResources = scopeResults.flatMap(sr => sr.result.resources);
  const allPackages = scopeResults.flatMap(sr => sr.result.packages);

  // Filter to specific package if provided
  let filteredResources = allResources;
  let filteredPackages = allPackages;
  if (packageFilter) {
    filteredResources = allResources.filter(r => r.packageName === packageFilter);
    filteredPackages = allPackages.filter(p => p.packageName === packageFilter);

    if (filteredResources.length === 0 && filteredPackages.length === 0) {
      s.stop('No resources found');
      throw new ValidationError(`Package '${packageFilter}' not found.`);
    }
  }

  // Only show packages with 2+ resources in the packages section
  // (single-resource packages are fully represented by their resource entry)
  const multiResourcePackages = filteredPackages.filter(p => p.resourceCount >= 2);

  const totalItems = multiResourcePackages.length + filteredResources.length;
  
  if (totalItems === 0) {
    s.stop('No installed resources found');
    note('Run `opkg install --list` to install resources.', 'Info');
    outro();
    return;
  }

  s.stop(`Found ${totalItems} item${totalItems === 1 ? '' : 's'}`);

  // Build grouped options for clack
  type ChoiceValue = { kind: 'resource'; resource: ResolvedResource } | { kind: 'package'; pkg: ResolvedPackage };
  const groupedOptions: Record<string, Array<{ value: ChoiceValue; label: string; hint: string }>> = {};

  // Packages section
  if (multiResourcePackages.length > 0) {
    groupedOptions['Packages'] = multiResourcePackages.map(pkg => {
      const versionSuffix = pkg.version && pkg.version !== '0.0.0' ? ` (v${pkg.version})` : '';
      const scopeTag = formatScopeTag(pkg.scope);
      return {
        value: { kind: 'package', pkg },
        label: `${pkg.packageName}${versionSuffix} (${pkg.resourceCount} resources)${scopeTag}`,
        hint: formatFileListHint(pkg.targetFiles, 2)
      };
    });
  }

  // Resources section
  if (filteredResources.length > 0) {
    groupedOptions['Resources'] = filteredResources.map(resource => {
      const typeLabel = resource.resourceType;
      const fromPkg = resource.packageName && !packageFilter
        ? `, from ${resource.packageName}`
        : '';
      const scopeTag = formatScopeTag(resource.scope);
      return {
        value: { kind: 'resource', resource },
        label: `${resource.resourceName} (${typeLabel}${fromPkg})${scopeTag}`,
        hint: formatFileListHint(resource.targetFiles, 2)
      };
    });
  }

  const selected = await clackGroupMultiselect<ChoiceValue>(
    'Select items to uninstall:',
    groupedOptions,
    {
      selectableGroups: false,
      groupSpacing: 0
    }
  );

  if (!selected || selected.length === 0) {
    cancel('Uninstall cancelled');
    return;
  }

  // Deduplicate: if a package is selected, skip its individual resources
  const selectedPackageNames = new Set(
    selected.filter(s => s.kind === 'package').map(s => s.pkg!.packageName)
  );
  const deduplicatedSelections = selected.filter(s => {
    if (s.kind === 'resource' && s.resource!.packageName && selectedPackageNames.has(s.resource!.packageName)) {
      return false;
    }
    return true;
  });

  if (deduplicatedSelections.length < selected.length) {
    const skipped = selected.length - deduplicatedSelections.length;
    note(
      `${skipped} individual resource${skipped === 1 ? '' : 's'} already included in package selection`,
      'Deduplication'
    );
  }

  for (const selection of deduplicatedSelections) {
    const candidate: ResolutionCandidate = selection.kind === 'package'
      ? { kind: 'package', package: selection.pkg }
      : { kind: 'resource', resource: selection.resource };
    const ctx = await createExecutionContext({
      global: (selection.kind === 'package' ? selection.pkg!.scope : selection.resource!.scope) === 'global',
      cwd: programOpts.cwd
    });
    
    // Add spinner for each uninstall operation
    const s = spinner();
    const itemName = selection.kind === 'package' 
      ? selection.pkg!.packageName 
      : selection.resource!.resourceName;
    s.start(`Uninstalling ${itemName}`);
    
    try {
      await executeCandidate(candidate, options, ctx);
      s.stop(`Uninstalled ${itemName}`);
    } catch (error) {
      s.error(`Failed to uninstall ${itemName}`);
      throw error;
    }
  }
  
  outro('Uninstall complete');
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function executeCandidate(
  candidate: ResolutionCandidate,
  options: UninstallOptions,
  execContext: ExecutionContext
): Promise<void> {
  if (candidate.kind === 'package') {
    const pkg = candidate.package!;
    const result = await runUninstallPipeline(pkg.packageName, options, execContext);
    if (!result.success) {
      throw new ValidationError(result.error || `Uninstall failed for ${pkg.packageName}`);
    }
    reportUninstallResult({
      packageName: pkg.packageName,
      removedFiles: result.data?.removedFiles ?? [],
      rootFilesUpdated: result.data?.rootFilesUpdated ?? []
    });
    return;
  }

  const resource = candidate.resource!;

  if (resource.kind === 'tracked') {
    // Selective uninstall from package via source keys
    const result = await runSelectiveUninstallPipeline(
      resource.packageName!,
      resource.sourceKeys,
      options,
      execContext
    );
    if (!result.success) {
      throw new ValidationError(result.error || `Uninstall failed for ${resource.resourceName}`);
    }
    reportResourceUninstallResult({
      resourceName: resource.resourceName,
      resourceType: resource.resourceType,
      packageName: resource.packageName,
      removedFiles: result.data?.removedFiles ?? [],
      rootFilesUpdated: result.data?.rootFilesUpdated ?? []
    });
    return;
  }

  // Untracked resource — direct file deletion
  const targetDir = execContext.targetDir;
  const removedFiles: string[] = [];

  if (options.dryRun) {
    note(
      `Would remove ${resource.targetFiles.length} file${resource.targetFiles.length === 1 ? '' : 's'}:\n${resource.targetFiles.slice(0, 3).join('\n')}${resource.targetFiles.length > 3 ? `\n... and ${resource.targetFiles.length - 3} more` : ''}`,
      'Dry Run Preview'
    );
  }

  for (const filePath of resource.targetFiles) {
    const absPath = path.join(targetDir, filePath);
    if (options.dryRun) {
      removedFiles.push(filePath);
    } else if (await exists(absPath)) {
      await remove(absPath);
      removedFiles.push(filePath);
    }
  }

  // Cleanup empty parent directories
  if (!options.dryRun && removedFiles.length > 0) {
    const preservedDirs = buildPreservedDirectoriesSet(targetDir);
    const deletedAbsPaths = removedFiles.map(f => path.join(targetDir, f));
    await cleanupEmptyParents(targetDir, deletedAbsPaths, preservedDirs);
  }

  reportResourceUninstallResult({
    resourceName: resource.resourceName,
    resourceType: resource.resourceType,
    removedFiles,
    rootFilesUpdated: []
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatCandidateTitle(candidate: ResolutionCandidate): string {
  if (candidate.kind === 'package') {
    const pkg = candidate.package!;
    const version = pkg.version && pkg.version !== '0.0.0' ? ` (v${pkg.version})` : '';
    const scopeTag = formatScopeTag(pkg.scope);
    return `${pkg.packageName}${version} (package, ${pkg.resourceCount} resources)${scopeTag}`;
  }
  const r = candidate.resource!;
  const fromPkg = r.packageName ? `, from ${r.packageName}` : '';
  const scopeTag = formatScopeTag(r.scope);
  return `${r.resourceName} (${r.resourceType}${fromPkg})${scopeTag}`;
}

function formatCandidateDescription(candidate: ResolutionCandidate): string {
  const files = candidate.kind === 'package'
    ? candidate.package!.targetFiles
    : candidate.resource!.targetFiles;
  return formatFileListDescription(files);
}

function formatFileListDescription(files: string[]): string {
  if (files.length === 0) return '(no files)';
  const displayFiles = files.slice(0, 5);
  const remaining = files.length - displayFiles.length;
  let desc = displayFiles.join('\n');
  if (remaining > 0) {
    desc += `\n(+${remaining} more)`;
  }
  return desc;
}

/**
 * Format file list for hints (show 2-3 files max)
 */
function formatFileListHint(files: string[], maxFiles: number = 2): string {
  if (files.length === 0) return '(no files)';
  const displayFiles = files.slice(0, maxFiles);
  const remaining = files.length - displayFiles.length;
  let hint = displayFiles.join(', ');
  if (remaining > 0) {
    hint += `, +${remaining} more`;
  }
  return hint;
}

// ---------------------------------------------------------------------------
// Command setup
// ---------------------------------------------------------------------------

export function setupUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .alias('un')
    .description('Remove installed resources or packages')
    .argument('[resource-spec]', 'name of the resource or package to uninstall')
    .option('-g, --global', 'uninstall from home directory (~/) instead of current workspace')
    .option('--dry-run', 'preview changes without applying them')
    .option('-l, --list', 'interactively select items to uninstall')
    .action(withErrorHandling(async (nameArg: string | undefined, options: UninstallCommandOptions, command: Command) => {
      await uninstallCommand(nameArg, options, command);
    }));
}
