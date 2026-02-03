/**
 * BulkInstallStrategy handles `opkg install` with no package argument.
 *
 * It expands the workspace manifest into multiple `InstallationContext`s and hands them
 * off to the multi-context pipeline via the orchestrator.
 */
import type { InstallationContext } from '../../unified/context.js';
import type { NormalizedInstallOptions, InputClassification, PreprocessResult } from '../types.js';
import { BaseInstallStrategy } from './base.js';
import { buildInstallContext, type BulkInstallContextsResult } from '../../unified/context-builders.js';

export class BulkInstallStrategy extends BaseInstallStrategy {
  readonly name = 'bulk';
  
  canHandle(classification: InputClassification): boolean {
    return classification.type === 'bulk';
  }
  
  async buildContext(
    classification: InputClassification,
    options: NormalizedInstallOptions,
    cwd: string
  ): Promise<InstallationContext> {
    // Bulk install returns multiple contexts, but we need to return one
    // The actual multi-context handling is done in preprocess
    // Return a placeholder context
    return {
      source: { type: 'workspace', packageName: '__bulk__' },
      mode: 'install',
      options,
      platforms: [],
      cwd,
      targetDir: '.',
      resolvedPackages: [],
      warnings: [],
      errors: []
    };
  }
  
  async preprocess(
    context: InstallationContext,
    options: NormalizedInstallOptions,
    cwd: string
  ): Promise<PreprocessResult> {
    // Build workspace + dependency contexts from openpackage.yml
    const raw = await buildInstallContext(cwd, undefined, options);

    const bulk = raw as BulkInstallContextsResult;
    if (bulk?.dependencyContexts && 'workspaceContext' in bulk) {
      const { workspaceContext: wsCtx, dependencyContexts: depCtxs } = bulk;
      if (depCtxs.length === 0 && !wsCtx) {
        return this.createNormalResult(context);
      }
      return {
        context,
        specialHandling: 'multi-resource',
        resourceContexts: depCtxs,
        workspaceContext: wsCtx ?? null
      };
    }

    // Legacy array shape (shouldn't happen for bulk)
    if (Array.isArray(raw)) {
      if (raw.length === 0) return this.createNormalResult(context);
      return this.createMultiResourceResult(raw[0], raw);
    }

    return this.createNormalResult(raw as InstallationContext);
  }
}
