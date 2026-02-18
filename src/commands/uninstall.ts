import path from 'path';
import { Command } from 'commander';
import { note, spinner, outro, cancel, taskLog } from '@clack/prompts';

import type { UninstallOptions, ExecutionContext } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { runUninstallPipeline, runSelectiveUninstallPipeline } from '../core/uninstall/uninstall-pipeline.js';
import { reportUninstallResult, reportResourceUninstallResult } from '../core/uninstall/uninstall-reporter.js';
import { createExecutionContext } from '../core/execution-context.js';
import { remove, exists } from '../utils/fs.js';
import { buildWorkspaceResources, type ResolvedResource, type ResolvedPackage } from '../core/resources/resource-builder.js';
import { resolveByName, type ResolutionCandidate } from '../core/resources/resource-resolver.js';
import { traverseScopes, traverseScopesFlat, type ResourceScope } from '../core/resources/scope-traversal.js';
import { disambiguate } from '../core/resources/disambiguation-prompt.js';
import { buildPreservedDirectoriesSet } from '../utils/directory-preservation.js';
import { cleanupEmptyParents } from '../utils/cleanup-empty-parents.js';
import { formatScopeTag, formatPathForDisplay } from '../utils/formatters.js';
import { clackGroupMultiselect } from '../utils/clack-multiselect.js';
import { normalizeType, RESOURCE_TYPE_ORDER, toLabelPlural } from '../core/resources/resource-registry.js';
import { parsePackageYml } from '../utils/package-yml.js';
import { readWorkspaceIndex } from '../utils/workspace-index-yml.js';
import { join } from 'path';

interface UninstallCommandOptions extends UninstallOptions {
  global?: boolean;
  interactive?: boolean;
}

async function uninstallCommand(
  nameArg: string | undefined,
  options: UninstallCommandOptions,
  command: Command
) {
  const programOpts = command.parent?.opts() || {};
  // Default to project (local) scope; -g switches to global (matches install)
  const traverseOpts = {
    programOpts,
    ...(options.global ? { globalOnly: true as const } : { projectOnly: true as const }),
  };

  if (options.interactive) {
    await handleListUninstall(nameArg, options, programOpts, traverseOpts);
    return;
  }

  if (!nameArg) {
    throw new ValidationError('Resource or package name is required. Use --interactive to interactively select.');
  }

  await handleDirectUninstall(nameArg, options, programOpts, traverseOpts);
}

// ---------------------------------------------------------------------------
// Direct uninstall: opkg un <name>
// ---------------------------------------------------------------------------

async function handleDirectUninstall(
  name: string,
  options: UninstallCommandOptions,
  programOpts: Record<string, any>,
  traverseOpts: { programOpts?: Record<string, any>; globalOnly?: boolean; projectOnly?: boolean }
) {
  const candidates = await traverseScopesFlat<ResolutionCandidate>(
    traverseOpts,
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
    console.log('Uninstall cancelled');
    return;
  }

  // #region agent log
  for (const c of selected) { fetch('http://127.0.0.1:7243/ingest/f66bae36-2cc1-4c38-8529-d173654652f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uninstall.ts:handleDirectUninstall',message:'direct uninstall selected',data:{candidateKind:c.kind,packageName:c.package?.packageName ?? c.resource?.packageName},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{}); }
  // #endregion
  for (const candidate of selected) {
    const ctx = await createExecutionContext({
      global: candidate.resource?.scope === 'global' || candidate.package?.scope === 'global',
      cwd: programOpts.cwd,
      interactive: false
    });
    await executeCandidate(candidate, options, ctx);
  }
}

// ---------------------------------------------------------------------------
// Interactive selection: opkg un --interactive [package-name]
// ---------------------------------------------------------------------------

async function handleListUninstall(
  packageFilter: string | undefined,
  options: UninstallCommandOptions,
  programOpts: Record<string, any>,
  traverseOpts: { programOpts?: Record<string, any>; globalOnly?: boolean; projectOnly?: boolean }
) {
  // Build resources from applicable scopes with spinner
  const s = spinner();
  s.start('Loading installed resources');
  
  // Store scope-to-targetDir mapping for later use
  const scopeToTargetDir = new Map<ResourceScope, string>();
  
  const scopeResults = await traverseScopes(
    traverseOpts,
    async ({ scope, context }) => {
      scopeToTargetDir.set(scope, context.targetDir);
      return buildWorkspaceResources(context.targetDir, scope);
    }
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

  // Build grouped options for clack
  type ChoiceValue = 
    | { kind: 'resource'; resource: ResolvedResource }
    | { kind: 'package'; packageName: string; scope: ResourceScope; resources: ResolvedResource[] };
  const groupedOptions: Record<string, Array<{ value: ChoiceValue; label: string; hint: string }>> = {};
  
  // Separate tracked resources by package+scope and untracked resources
  const resourcesByPackageAndScope = new Map<string, ResolvedResource[]>();
  const untrackedResources: ResolvedResource[] = [];

  for (const resource of filteredResources) {
    if (resource.kind === 'tracked' && resource.packageName) {
      const key = `${resource.packageName}::${resource.scope}`;
      if (!resourcesByPackageAndScope.has(key)) {
        resourcesByPackageAndScope.set(key, []);
      }
      resourcesByPackageAndScope.get(key)!.push(resource);
    } else {
      untrackedResources.push(resource);
    }
  }

  // Add empty packages (packages with 0 resources) to the map, keyed by package+scope
  for (const pkg of filteredPackages) {
    const key = `${pkg.packageName}::${pkg.scope}`;
    if (!resourcesByPackageAndScope.has(key)) {
      resourcesByPackageAndScope.set(key, []);
    }
  }

  // Create package groups for ALL packages (sorted alphabetically, then by scope)
  const packageGroups = Array.from(resourcesByPackageAndScope.entries())
    .sort((a, b) => {
      const [pkgA, scopeA] = a[0].split('::');
      const [pkgB, scopeB] = b[0].split('::');
      const nameCompare = pkgA.localeCompare(pkgB);
      if (nameCompare !== 0) return nameCompare;
      // Sort project before global
      return scopeA === 'project' ? -1 : 1;
    });

  // Calculate total items: package groups + untracked resources
  const totalItems = packageGroups.length + untrackedResources.length;
  
  if (totalItems === 0) {
    s.stop('No installed resources found');
    note('Run `opkg install --interactive` to install resources.', 'Info');
    outro();
    return;
  }

  s.stop(`Found ${totalItems} item${totalItems === 1 ? '' : 's'}`);

  // Read package manifests to get dependency counts for packages with no resources
  const packageDependencyCounts = new Map<string, number>();
  for (const pkg of filteredPackages) {
    try {
      // Get the target directory for this package's scope
      const targetDir = scopeToTargetDir.get(pkg.scope);
      if (!targetDir) continue;
      
      // Read from the workspace index to get the package path
      const { index } = await readWorkspaceIndex(targetDir);
      const pkgEntry = index.packages[pkg.packageName];
      if (!pkgEntry?.path) continue;
      
      // Resolve the package path
      const packagePath = pkgEntry.path.startsWith('~') 
        ? pkgEntry.path.replace('~', programOpts.homeDir || process.env.HOME || process.env.USERPROFILE || '')
        : pkgEntry.path;
      
      const manifestPath = join(packagePath, 'openpackage.yml');
      const manifest = await parsePackageYml(manifestPath);
      const depCount = (manifest.dependencies || []).length + (manifest['dev-dependencies'] || []).length;
      packageDependencyCounts.set(`${pkg.packageName}::${pkg.scope}`, depCount);
    } catch (error) {
      // If manifest can't be read, assume 0 dependencies
      packageDependencyCounts.set(`${pkg.packageName}::${pkg.scope}`, 0);
    }
  }

  // 1. Build "Packages" category with flat package items
  const packageOptions: Array<{ value: ChoiceValue; label: string; hint: string }> = [];
  
  for (const [key, resources] of packageGroups) {
    const [pkgName, scope] = key.split('::');
    const pkg = filteredPackages.find(p => p.packageName === pkgName && p.scope === scope);
    const versionSuffix = pkg?.version && pkg.version !== '0.0.0' ? `@${pkg.version}` : '';
    const scopeTag = pkg ? formatScopeTag(pkg.scope) : formatScopeTag(scope);
    
    // Create a single package-level choice
    const resourceCount = resources.length;
    const depCount = packageDependencyCounts.get(key) || 0;
    
    let hint: string;
    if (resourceCount === 0) {
      hint = depCount > 0 
        ? `No resources, declares ${depCount} ${depCount === 1 ? 'dependency' : 'dependencies'}`
        : 'No resources';
    } else {
      // Count total files across all resources
      const totalFiles = resources.flatMap(r => r.targetFiles).length;
      hint = `${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}`;
    }
    
    packageOptions.push({
      value: { kind: 'package', packageName: pkgName, scope: scope as ResourceScope, resources },
      label: `${pkgName}${versionSuffix}${scopeTag}`,
      hint
    });
  }
  
  // Add packages category if there are any packages
  if (packageOptions.length > 0) {
    groupedOptions['Packages'] = packageOptions;
  }

  // 2. Untracked resources grouped by type category (using RESOURCE_TYPE_ORDER)
  const untrackedByType = new Map<string, ResolvedResource[]>();
  for (const resource of untrackedResources) {
    const type = normalizeType(resource.resourceType);
    if (!untrackedByType.has(type)) {
      untrackedByType.set(type, []);
    }
    untrackedByType.get(type)!.push(resource);
  }

  // Use RESOURCE_TYPE_ORDER for consistent ordering - only show categories with resources
  for (const typeId of RESOURCE_TYPE_ORDER) {
    const resources = untrackedByType.get(typeId);
    if (!resources || resources.length === 0) continue;
    
    const categoryName = toLabelPlural(typeId); // "Rules", "Commands", "Agents", "Skills", "Hooks", "MCP Servers"
    
    groupedOptions[categoryName] = resources.map(resource => {
      const scopeTag = formatScopeTag(resource.scope);
      const fileCount = resource.targetFiles.length;
      return {
        value: { kind: 'resource', resource },
        label: `${resource.resourceName}${scopeTag}`,
        hint: `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`
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

  // Create task log for batch uninstall (minimal output - no per-resource grouping)
  const log = taskLog({
    title: `Uninstalling ${selected.length} item${selected.length === 1 ? '' : 's'}`
  });

  // Track counts by type for summary
  const typeCounts = new Map<string, number>();
  let uninstalledCount = 0;
  const allRemovedFiles: Array<{ path: string; targetDir: string }> = [];

  for (const selection of selected) {
    if (selection.kind === 'package') {
      // User selected an entire package - use full package uninstall (same as direct uninstall)
      // so that manifest (openpackage.yml) and workspace index are properly updated.
      const { packageName, scope, resources } = selection;
      const targetDir = scopeToTargetDir.get(scope);
      const pkg = filteredPackages.find(p => p.packageName === packageName && p.scope === scope);
      const ctx = await createExecutionContext({
        global: scope === 'global',
        cwd: programOpts.cwd,
        interactive: true
      });
      const candidate: ResolutionCandidate = {
        kind: 'package',
        package: {
          packageName,
          scope,
          version: pkg?.version,
          resourceCount: resources.length,
          targetFiles: resources.flatMap(r => r.targetFiles)
        }
      };
      try {
        if (targetDir) {
          candidate.package!.targetFiles.forEach(f => allRemovedFiles.push({ path: f, targetDir }));
        }
        await executeCandidate(candidate, options, ctx);
        typeCounts.set('packages', (typeCounts.get('packages') || 0) + 1);
        uninstalledCount++;
      } catch (error) {
        log.error(`Failed to uninstall ${packageName}`);
        throw error;
      }
    } else {
      // User selected an individual resource
      const resource = selection.resource;
      const targetDir = scopeToTargetDir.get(resource.scope);
      const candidate: ResolutionCandidate = { kind: 'resource', resource };
      const ctx = await createExecutionContext({
        global: resource.scope === 'global',
        cwd: programOpts.cwd,
        interactive: true
      });
      
      try {
        // Collect files before execution
        if (targetDir) {
          resource.targetFiles.forEach(f => allRemovedFiles.push({ path: f, targetDir }));
        }
        
        await executeCandidate(candidate, options, ctx);
        
        // Track by resource type
        const typePlural = toLabelPlural(normalizeType(resource.resourceType)).toLowerCase();
        typeCounts.set(typePlural, (typeCounts.get(typePlural) || 0) + 1);
        uninstalledCount++;
      } catch (error) {
        log.error(`Failed to uninstall ${resource.resourceName}`);
        throw error;
      }
    }
  }

  // Build breakdown message
  const breakdown = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');

  log.success(`Successfully uninstalled ${uninstalledCount} item${uninstalledCount === 1 ? '' : 's'} (${breakdown})`);

  // Show removed files as flat list using clack note (no tree branch - interactive box provides structure)
  if (allRemovedFiles.length > 0) {
    const cwd = process.cwd();
    // Resolve to absolute paths for unified formatter, dedupe, then sort
    const absolutePaths = [...new Set(
      allRemovedFiles.map(({ path: p, targetDir }) => join(targetDir, p))
    )].sort((a, b) => a.localeCompare(b));
    const displayFiles = absolutePaths.slice(0, 10);
    const fileLines = displayFiles.map(f => `${formatPathForDisplay(f, cwd)}`);
    const more = absolutePaths.length > 10 ? `\n... and ${absolutePaths.length - 10} more` : '';
    note(fileLines.join('\n') + more, 'Removed files');
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
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/f66bae36-2cc1-4c38-8529-d173654652f4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uninstall.ts:executeCandidate',message:'executeCandidate called',data:{candidateKind:candidate.kind,packageName:candidate.package?.packageName ?? candidate.resource?.packageName},timestamp:Date.now(),hypothesisId:'A',runId:'post-fix'})}).catch(()=>{});
  // #endregion
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
    }, execContext);
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
    }, execContext);
    return;
  }

  // Untracked resource — direct file deletion
  const targetDir = execContext.targetDir;
  const removedFiles: string[] = [];

  if (options.dryRun) {
    console.log(`\n(dry-run) Would remove ${resource.targetFiles.length} file${resource.targetFiles.length === 1 ? '' : 's'}:`);
    const displayFiles = resource.targetFiles.slice(0, 10);
    for (const file of displayFiles) {
      console.log(`   ├── ${file}`);
    }
    if (resource.targetFiles.length > 10) {
      console.log(`   ... and ${resource.targetFiles.length - 10} more`);
    }
  }

  for (const filePath of resource.targetFiles) {
    const absPath = path.join(targetDir, filePath);
  if (options.dryRun && !execContext.interactive) {
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
  }, execContext);
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
  if (files.length === 0) return 'no files';
  const displayFiles = files.slice(0, 5);
  const remaining = files.length - displayFiles.length;
  let desc = displayFiles.join('\n');
  if (remaining > 0) {
    desc += `\n+${remaining} more`;
  }
  return desc;
}

/**
 * Format file list for hints (show 2-3 files max)
 */
function formatFileListHint(files: string[], maxFiles: number = 2): string {
  if (files.length === 0) return 'no files';
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
    .option('-i, --interactive', 'interactively select items to uninstall')
    .action(withErrorHandling(async (nameArg: string | undefined, options: UninstallCommandOptions, command: Command) => {
      await uninstallCommand(nameArg, options, command);
    }));
}
