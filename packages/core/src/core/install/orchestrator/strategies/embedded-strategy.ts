/**
 * EmbeddedInstallStrategy handles installs of embedded sub-packages
 * identified by qualified names (parent/child).
 *
 * Resolution:
 * 1. Look up parent in workspace index (already installed)
 * 2. If not found, resolve parent from registry
 * 3. Locate packages/<child>/ inside parent content root
 * 4. Build an InstallationContext with source.type: 'path'
 */

import path from 'path';

import type { InstallationContext, PackageSource } from '../../unified/context.js';
import type { ExecutionContext } from '../../../../types/index.js';
import type { NormalizedInstallOptions, InputClassification, PreprocessResult } from '../types.js';
import type { UnifiedSpinner } from '../../../ports/output.js';
import { BaseInstallStrategy } from './base.js';
import { normalizePlatforms } from '../../../platform/platform-mapper.js';
import { readWorkspaceIndex } from '../../../../utils/workspace-index-yml.js';
import { resolveDeclaredPath } from '../../../../utils/path-resolution.js';
import { resolvePackageContentRoot } from '../../local-source-resolution.js';
import { exists } from '../../../../utils/fs.js';
import { ValidationError } from '../../../../utils/errors.js';
import { buildQualifiedName } from '../../../../utils/qualified-name.js';
import { logger } from '../../../../utils/logger.js';

export class EmbeddedInstallStrategy extends BaseInstallStrategy {
  readonly name = 'embedded';

  canHandle(classification: InputClassification): boolean {
    return classification.type === 'embedded';
  }

  async buildContext(
    classification: InputClassification,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<InstallationContext> {
    if (classification.type !== 'embedded') {
      throw new Error('EmbeddedStrategy cannot handle non-embedded classification');
    }

    const { parentName, embeddedName, qualifiedName, version } = classification;
    const targetDir = execContext.targetDir;

    // Try to find the parent's content root
    let parentContentRoot: string | undefined;

    // 1. Check workspace index for already-installed parent
    try {
      const { index } = await readWorkspaceIndex(targetDir);
      const parentEntry = index.packages?.[parentName];
      if (parentEntry?.path) {
        const { absolute } = resolveDeclaredPath(parentEntry.path, targetDir);
        parentContentRoot = absolute;
      }
    } catch {
      // Index not available
    }

    // 2. Fall back to registry resolution
    if (!parentContentRoot) {
      try {
        parentContentRoot = await resolvePackageContentRoot({
          cwd: targetDir,
          packageName: parentName,
          version: version ?? '*',
        });
      } catch {
        throw new ValidationError(
          `Cannot install embedded package '${qualifiedName}': parent package '${parentName}' ` +
          `is not installed and could not be found in the registry.\n` +
          `Install the parent first: opkg install ${parentName}`
        );
      }
    }

    // 3. Locate packages/<child>/ inside parent
    const embeddedPath = path.join(parentContentRoot, 'packages', embeddedName);
    if (!(await exists(embeddedPath))) {
      throw new ValidationError(
        `Embedded package '${embeddedName}' not found in parent '${parentName}'.\n` +
        `Expected location: ${embeddedPath}`
      );
    }

    const source: PackageSource = {
      type: 'path',
      packageName: qualifiedName,
      localPath: embeddedPath,
      sourceType: 'directory',
      contentRoot: embeddedPath,
      version,
    };

    return {
      execution: execContext,
      targetDir,
      source,
      mode: 'install',
      options,
      platforms: normalizePlatforms(options.platforms) || [],
      resolvedPackages: [],
      warnings: [],
      errors: [],
      installScope: 'full',
    };
  }

  async preprocess(
    context: InstallationContext,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext,
    spinner?: UnifiedSpinner
  ): Promise<PreprocessResult> {
    // Standard path preprocessing — return as normal result
    return this.createNormalResult(context);
  }
}
