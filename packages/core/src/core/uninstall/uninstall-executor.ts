/**
 * Uninstall Executor
 *
 * Executes a single uninstall candidate (package or resource).
 * Extracted from the CLI command layer so the same logic can
 * be driven by any UI (CLI, GUI, tests).
 */

import path from 'path';
import type { UninstallOptions } from '../../types/index.js';
import type { ExecutionContext } from '../../types/execution-context.js';
import { ValidationError } from '../../utils/errors.js';
import { remove, exists } from '../../utils/fs.js';
import { buildPreservedDirectoriesSet } from '../platform/directory-preservation.js';
import { cleanupEmptyParents } from '../../utils/cleanup-empty-parents.js';
import { runUninstallPipeline, runSelectiveUninstallPipeline } from './uninstall-pipeline.js';
import { reportUninstallResult, reportResourceUninstallResult } from './uninstall-reporter.js';
import type { ResolutionCandidate } from '../resources/resource-resolver.js';
import { resolveOutput } from '../ports/resolve.js';

/**
 * Execute a single uninstall candidate (package or individual resource).
 */
export async function executeUninstallCandidate(
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
    }, execContext);
    return;
  }

  const resource = candidate.resource!;

  if (resource.kind === 'tracked') {
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
  const out = resolveOutput(execContext);
  const removedFiles: string[] = [];

  if (options.dryRun) {
    out.info(`(dry-run) Would remove ${resource.targetFiles.length} file${resource.targetFiles.length === 1 ? '' : 's'}:`);
    const displayFiles = resource.targetFiles.slice(0, 10);
    for (const file of displayFiles) {
      out.message(`   ├── ${file}`);
    }
    if (resource.targetFiles.length > 10) {
      out.message(`   ... and ${resource.targetFiles.length - 10} more`);
    }
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
  }, execContext);
}
