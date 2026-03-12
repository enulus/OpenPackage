/**
 * Add Orchestrator
 *
 * Core orchestration logic for the `add` command.
 * Classifies input, dispatches to the correct pipeline (dependency, workspace-resource, copy),
 * and returns typed results. No terminal-UI dependencies.
 */

import { basename, join, relative, resolve } from 'path';

import fg from 'fast-glob';
import { isJunk } from 'junk';

import type { ExecutionContext } from '../../types/execution-context.js';
import type { CommandResult } from '../../types/index.js';
import type { ResourceTypeId, ResourceTypeDef } from '../../types/resources.js';
import { classifyAddInput, type AddInputClassification, type AddClassifyOptions } from './add-input-classifier.js';
import { runAddDependencyFlow, type AddDependencyResult, type AddDependencyOptions } from './add-dependency-flow.js';
import { runAddToSourcePipeline, runAddToSourcePipelineBatch, addSourceEntriesToPackage, type AddToSourceResult, type AddToSourceOptions } from './add-to-source-pipeline.js';
import { classifyResourceSpec, resolveResourceSpec } from '../resources/resource-spec.js';
import { mapWorkspaceFileToUniversal } from '../platform/platform-mapper.js';
import { disambiguatePlatform, groupFilesByPlatform } from '../platform/platform-disambiguation.js';
import { getResourceTypeDef } from '../resources/resource-registry.js';
import { getDetectedPlatforms, getPlatformDefinition, deriveRootDirFromFlows } from '../platforms.js';
import { exists } from '../../utils/fs.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AddResourceResult =
  | { kind: 'dependency'; result: AddDependencyResult; classification: AddInputClassification }
  | { kind: 'copy'; result: CommandResult<AddToSourceResult> }
  | { kind: 'workspace-resource'; result: CommandResult<AddToSourceResult> };

export interface ProcessAddResourceOptions {
  copy?: boolean;
  dev?: boolean;
  to?: string;
  platform?: string;
  platformSpecific?: boolean;
  force?: boolean;
}

// ---------------------------------------------------------------------------
// Filesystem discovery
// ---------------------------------------------------------------------------

/**
 * Scan all platform directories for files belonging to a specific resource.
 * Returns absolute paths found on disk — no index/install-state needed.
 */
async function discoverResourceFiles(
  typeDef: ResourceTypeDef,
  resourceName: string,
  targetDir: string,
): Promise<string[]> {
  const platforms = await getDetectedPlatforms(targetDir);
  const seen = new Set<string>();
  const results: string[] = [];
  const escaped = fg.escapePath(resourceName);

  for (const platform of platforms) {
    try {
      const def = getPlatformDefinition(platform, targetDir);
      const rootDir = deriveRootDirFromFlows(def);
      const cwd = join(targetDir, rootDir, typeDef.dirName!);

      // Marker-based (e.g. skills/) → grab everything inside the directory
      // File-based (e.g. rules/) → also grab single-file matches like name.*
      const patterns = [`${escaped}/**/*`];
      if (!typeDef.marker) {
        patterns.push(`${escaped}.*`);
      }

      const matches = await fg(patterns, { cwd, absolute: true, dot: false });
      for (const abs of matches) {
        if (isJunk(basename(abs))) continue;
        if (seen.has(abs)) continue;
        seen.add(abs);
        results.push(abs);
      }
    } catch {
      // Platform directory may not exist — expected, skip.
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Check if input looks like a bare name (could be registry or local path) */
function isBareNameInput(input: string): boolean {
  return (
    !input.startsWith('./') &&
    !input.startsWith('../') &&
    !input.startsWith('/') &&
    !input.startsWith('~') &&
    !input.endsWith('/')
  );
}

/**
 * Process a single resource spec through the add pipeline.
 * Classifies the input and dispatches to the appropriate flow
 * (dependency, workspace-resource, or copy).
 *
 * Returns a typed discriminated union so the caller (CLI or GUI)
 * can render the result however it chooses.
 */
export async function processAddResource(
  resourceSpec: string,
  options: ProcessAddResourceOptions,
  cwd: string,
  execContext: ExecutionContext
): Promise<AddResourceResult> {
  // Check if input is a resource reference (e.g., `agents/ui-designer`)
  const spec = classifyResourceSpec(resourceSpec);

  if (spec.kind === 'resource-ref') {
    if (options.dev) {
      throw new Error('--dev can only be used when adding a dependency, not when copying files');
    }
    const traverseOpts = { programOpts: { cwd } };
    const resolved = await resolveResourceSpec(resourceSpec, traverseOpts, {
      notFoundMessage: `"${resourceSpec}" not found as a resource.\nRun \`opkg ls\` to see installed resources.`,
      promptMessage: 'Select which resource to add:',
      multi: false,
      scopePreference: 'project',
    }, execContext);

    if (resolved.length === 0) {
      throw new Error(`No resource found for "${resourceSpec}".`);
    }

    const { candidate, targetDir } = resolved[0];
    const resource = candidate.resource!;

    // Discover files from the filesystem — no install-state needed.
    // For types with a dirName (skills, rules, agents, etc.) we scan platform
    // directories directly. For dirName:null types (mcp, plugin, other) we
    // fall back to the index's targetFiles with an exists() check.
    const resourceType = resource.resourceType as ResourceTypeId;
    const typeDef = getResourceTypeDef(resourceType);
    let discoveredFiles: string[];

    if (typeDef.dirName) {
      discoveredFiles = await discoverResourceFiles(
        typeDef,
        resource.resourceName,
        targetDir,
      );
    } else {
      discoveredFiles = [];
      for (const tf of resource.targetFiles) {
        const abs = join(targetDir, tf);
        if (await exists(abs)) discoveredFiles.push(abs);
      }
    }

    // Platform disambiguation: filter discovered files to a single platform when multi-platform
    const relativeDiscovered = discoveredFiles.map(abs => ({
      abs,
      rel: relative(targetDir, abs),
    }));
    const platformGroups = groupFilesByPlatform(relativeDiscovered.map(f => f.rel), targetDir);
    const platformKeys = [...platformGroups.keys()].filter((k): k is string => k !== null);

    if (platformKeys.length > 1) {
      const selectedPlatform = await disambiguatePlatform({
        targetDir,
        resourceLabel: resourceSpec,
        specifiedPlatform: options.platform,
        execContext,
      });
      const allowedRels = new Set([
        ...(platformGroups.get(selectedPlatform) ?? []),
        ...(platformGroups.get(null) ?? []),
      ]);
      discoveredFiles = relativeDiscovered
        .filter(f => allowedRels.has(f.rel))
        .map(f => f.abs);
    }

    const entries: Array<{ sourcePath: string; registryPath: string; content?: string }> = [];
    const seenRegistryPaths = new Set<string>();

    for (const absSource of discoveredFiles) {
      let mapping;
      try {
        mapping = mapWorkspaceFileToUniversal(absSource, targetDir);
      } catch {
        continue;
      }
      if (!mapping) continue;
      const registryPath = [mapping.subdir, mapping.relPath].filter(Boolean).join('/');
      if (seenRegistryPaths.has(registryPath)) continue;
      seenRegistryPaths.add(registryPath);
      entries.push({ sourcePath: absSource, registryPath });
    }

    if (entries.length === 0) {
      const nameContext = resource.packageName || 'unknown source';
      throw new Error(`No source files found for resource "${resourceSpec}" from ${nameContext}.`);
    }

    const result = await addSourceEntriesToPackage(options.to, entries, { ...options, execContext });
    if (!result.success) {
      throw new Error(result.error || 'Add operation failed');
    }

    return { kind: 'workspace-resource', result };
  }

  // --platform only valid with resource references
  if (options.platform) {
    throw new Error('--platform can only be used with resource references (e.g., skills/foo), not file paths.');
  }

  const classification = await classifyAddInput(resourceSpec, cwd, {
    copy: options.copy,
    dev: options.dev,
  });

  if (classification.mode === 'dependency') {
    if (options.platformSpecific) {
      throw new Error('--platform-specific can only be used with --copy or when adding files');
    }
    try {
      const result = await runAddDependencyFlow(classification, {
        dev: options.dev,
        to: options.to,
      });
      return { kind: 'dependency', result, classification };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isBareNameInput(resourceSpec)) {
        const localPath = resolve(cwd, resourceSpec);
        if (await exists(localPath)) {
          throw new Error(
            `${msg}\n\nA local path './${resourceSpec}' exists — did you mean:\n  opkg add ./${resourceSpec}`
          );
        }
      }
      throw error;
    }
  }

  if (classification.mode === 'workspace-resource') {
    if (options.dev) {
      throw new Error('--dev can only be used when adding a dependency, not when copying files');
    }
    const resource = classification.resolvedResource!;
    const absPath = resource.sourcePath || join(execContext.targetDir, resource.targetFiles[0]);

    const result = await runAddToSourcePipeline(options.to, absPath, { ...options, execContext });
    if (!result.success) {
      throw new Error(result.error || 'Add operation failed');
    }
    return { kind: 'workspace-resource', result };
  }

  // copy mode
  if (options.dev) {
    throw new Error('--dev can only be used when adding a dependency, not when copying files');
  }
  const result = await runAddToSourcePipeline(options.to, classification.copySourcePath!, { ...options, execContext });
  if (!result.success) {
    throw new Error(result.error || 'Add operation failed');
  }
  return { kind: 'copy', result };
}
