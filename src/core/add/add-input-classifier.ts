import { resolve } from 'path';
import { exists } from '../../utils/fs.js';
import { classifyInputBase, type BaseInputClassification } from '../../utils/input-classifier-base.js';
import { ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export type AddMode = 'dependency' | 'copy' | 'workspace-resource';

export interface AddInputClassification {
  mode: AddMode;
  packageName?: string;
  version?: string;
  gitUrl?: string;
  gitRef?: string;
  gitPath?: string;
  localPath?: string;
  resourcePath?: string;
  copySourcePath?: string;
  /** Resolved workspace resource (for workspace-resource mode) */
  resolvedResource?: import('../resources/resource-builder.js').ResolvedResource;
}

export interface AddClassifyOptions {
  copy?: boolean;
  dev?: boolean;
}

function looksLikePath(input: string): boolean {
  return input.startsWith('/') || input.startsWith('./') || input.startsWith('../') || input.startsWith('~') || input === '.';
}

/**
 * Classify add command input to determine mode (dependency vs. copy) and extract metadata.
 * 
 * Uses the shared base classifier and enriches results with add-specific mode determination:
 * - dependency mode: Add package reference to manifest
 * - copy mode: Physically copy files to package source
 * 
 * @param input - User input string
 * @param cwd - Current working directory
 * @param options - Add-specific options (--copy, --dev)
 * @returns Add classification with mode and metadata
 */
export async function classifyAddInput(
  input: string,
  cwd: string,
  options: AddClassifyOptions
): Promise<AddInputClassification> {
  // 1. Handle --copy flag first (force copy mode)
  if (options.copy) {
    return handleCopyMode(input, cwd);
  }

  // 2. Use base classifier
  const base = await classifyInputBase(input, cwd);

  // 3. Convert to add-specific classification with mode
  return enrichWithAddMode(base);
}

/**
 * Handle --copy mode (force copy regardless of input type)
 */
async function handleCopyMode(
  input: string,
  cwd: string
): Promise<AddInputClassification> {
  if (!looksLikePath(input)) {
    throw new ValidationError('--copy can only be used with local paths');
  }
  
  const resolvedAbsPath = resolve(cwd, input);
  if (!(await exists(resolvedAbsPath))) {
    throw new ValidationError(`Path not found: ${input}`);
  }
  
  return { mode: 'copy', copySourcePath: resolvedAbsPath };
}

/**
 * Enrich base classification with add-specific mode determination
 */
function enrichWithAddMode(
  base: BaseInputClassification
): AddInputClassification {
  switch (base.type) {
    case 'bulk':
      throw new ValidationError('Add command requires an input argument');

    case 'git':
      return {
        mode: 'dependency',
        packageName: base.derivedName!,
        gitUrl: base.gitUrl,
        gitRef: base.gitRef,
        gitPath: base.gitPath
      };

    case 'local-path': {
      // Determine if dependency or copy based on package validity
      if (base.isValidPackage) {
        logger.debug('Classified local directory as dependency', {
          packageName: base.packageName,
          absolutePath: base.absolutePath
        });
        return {
          mode: 'dependency',
          packageName: base.packageName!,
          localPath: base.absolutePath
        };
      }
      
      // Not a valid package - copy mode
      return {
        mode: 'copy',
        copySourcePath: base.absolutePath
      };
    }

    case 'registry':
      return {
        mode: 'dependency',
        packageName: base.packageName,
        version: base.version,
        resourcePath: base.registryPath
      };
  }
}
