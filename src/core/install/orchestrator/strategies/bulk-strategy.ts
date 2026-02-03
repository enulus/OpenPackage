/**
 * BulkInstallStrategy handles `opkg install` with no package argument.
 *
 * It expands the workspace manifest into multiple `InstallationContext`s and hands them
 * off to the multi-context pipeline via the orchestrator.
 */
import type { InstallationContext } from '../../unified/context.js';
import type { NormalizedInstallOptions, InputClassification, PreprocessResult } from '../types.js';
import { BaseInstallStrategy } from './base.js';
import { buildInstallContext } from '../../unified/context-builders.js';

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
    // Build all contexts from openpackage.yml
    const contexts = await buildInstallContext(cwd, undefined, options);
    
    if (Array.isArray(contexts)) {
      if (contexts.length === 0) {
        // Return context that will trigger "no packages" message
        return this.createNormalResult(context);
      }
      return this.createMultiResourceResult(contexts[0], contexts);
    }
    
    // Single context (shouldn't happen for bulk, but handle gracefully)
    return this.createNormalResult(contexts);
  }
}
