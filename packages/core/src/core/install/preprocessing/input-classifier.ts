import type { InputClassification, InputFeatures } from '../orchestrator/types.js';
import type { InstallOptions, ExecutionContext } from '../../../types/index.js';
import { classifyInputBase, type BaseInputClassification } from '../../../utils/input-classifier-base.js';

/**
 * Classify package input for routing to appropriate install strategy.
 * 
 * Uses the shared base classifier and enriches results with install-specific features:
 * - Convenience filters (--agents, --skills, --rules, --commands)
 * - Resource path tracking for selective installation
 * 
 * @param input - Raw user input (undefined for bulk install)
 * @param options - Install options (to check for convenience filters)
 * @param execContext - Execution context (uses sourceCwd for resolving inputs)
 * @returns Unified input classification with install features
 */
export async function classifyInput(
  input: string | undefined,
  options: InstallOptions & { agents?: string[]; skills?: string[]; rules?: string[]; commands?: string[] },
  execContext: ExecutionContext
): Promise<InputClassification> {
  // Detect convenience filters
  const hasConvenienceFilters = !!(
    options.agents?.length ||
    options.skills?.length ||
    options.rules?.length ||
    options.commands?.length
  );

  // Use base classifier
  const base = await classifyInputBase(input, execContext.sourceCwd);

  // Convert to install-specific classification with features
  return enrichWithInstallFeatures(base, hasConvenienceFilters);
}

/**
 * Enrich base classification with install-specific features
 */
function enrichWithInstallFeatures(
  base: BaseInputClassification,
  hasConvenienceFilters: boolean
): InputClassification {
  const features: InputFeatures = {
    hasConvenienceFilters,
    hasResourcePath: false
  };

  switch (base.type) {
    case 'bulk':
      return { type: 'bulk', features };

    case 'git':
      return {
        type: 'git',
        gitUrl: base.gitUrl,
        gitRef: base.gitRef,
        resourcePath: base.gitPath,
        features: {
          ...features,
          hasResourcePath: !!base.gitPath
        }
      };

    case 'local-path':
      return {
        type: 'path',
        localPath: base.absolutePath,
        features
      };

    case 'registry':
      return {
        type: 'registry',
        packageName: base.packageName,
        version: base.version,
        resourcePath: base.registryPath,
        features: {
          ...features,
          hasResourcePath: !!base.registryPath
        }
      };
  }
}

