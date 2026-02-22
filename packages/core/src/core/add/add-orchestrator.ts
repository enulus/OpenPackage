/**
 * Add Orchestrator
 *
 * Core orchestration logic for the `add` command.
 * Classifies input, dispatches to the correct pipeline (dependency, workspace-resource, copy),
 * and returns typed results. No terminal-UI dependencies.
 */

import { join, resolve } from 'path';

import type { ExecutionContext } from '../../types/execution-context.js';
import type { CommandResult } from '../../types/index.js';
import { classifyAddInput, type AddInputClassification, type AddClassifyOptions } from './add-input-classifier.js';
import { runAddDependencyFlow, type AddDependencyResult, type AddDependencyOptions } from './add-dependency-flow.js';
import { runAddToSourcePipeline, runAddToSourcePipelineBatch, type AddToSourceResult, type AddToSourceOptions } from './add-to-source-pipeline.js';
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
  platformSpecific?: boolean;
  force?: boolean;
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
