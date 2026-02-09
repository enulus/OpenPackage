import type { InputClassification } from '../orchestrator/types.js';
import type { InstallOptions, ExecutionContext } from '../../../types/index.js';
import { parseResourceArg, type ResourceSpec } from '../../../utils/resource-arg-parser.js';
import { classifyPackageInput } from '../../../utils/package-input.js';

/**
 * Classify package input for routing to appropriate install strategy.
 * 
 * Unifies the logic from:
 * - parseResourceArg() for resource-model parsing (gh@, URLs, paths)
 * - classifyPackageInput() for legacy classification
 * 
 * @param input - Raw user input (undefined for bulk install)
 * @param options - Install options (to check for convenience filters)
 * @param execContext - Execution context (uses sourceCwd for resolving inputs)
 * @returns Unified input classification
 */
export async function classifyInput(
  input: string | undefined,
  options: InstallOptions & { agents?: string[]; skills?: string[]; rules?: string[]; commands?: string[] },
  execContext: ExecutionContext
): Promise<InputClassification> {
  // No input = bulk install
  if (!input) {
    return {
      type: 'bulk',
      features: {
        hasResourcePath: false,
        hasConvenienceFilters: false
      }
    };
  }

  const hasConvenienceFilters = !!(options.agents?.length || options.skills?.length || options.rules?.length || options.commands?.length);

  // Determine if we should try resource parsing first
  // Resource parsing handles: gh@ shorthand, GitHub URLs, paths with sub-resources
  const shouldTryResourceParsing = 
    hasConvenienceFilters ||
    input.startsWith('gh@') ||
    input.startsWith('https://github.com/') ||
    input.startsWith('http://github.com/');

  if (shouldTryResourceParsing) {
    try {
      const resourceSpec = await parseResourceArg(input, execContext.sourceCwd);
      return resourceSpecToClassification(resourceSpec, hasConvenienceFilters);
    } catch (error) {
      // If resource parsing fails and no convenience options, fall through to legacy
      if (hasConvenienceFilters) {
        throw error; // With convenience options, resource parsing is required
      }
    }
  }

  // Fall back to legacy classification
  const legacy = await classifyPackageInput(input, execContext.sourceCwd);
  return legacyToClassification(legacy, hasConvenienceFilters);
}

/**
 * Convert ResourceSpec to InputClassification
 */
function resourceSpecToClassification(
  spec: ResourceSpec,
  hasConvenienceFilters: boolean
): InputClassification {
  const hasResourcePath = !!spec.path;

  switch (spec.type) {
    case 'github-url':
    case 'github-shorthand':
      return {
        type: 'git',
        gitUrl: spec.gitUrl!,
        gitRef: spec.ref,
        resourcePath: spec.path,
        features: {
          hasResourcePath,
          hasConvenienceFilters
        }
      };
    
    case 'filepath':
      return {
        type: 'path',
        localPath: spec.absolutePath!,
        features: {
          hasResourcePath: false,
          hasConvenienceFilters
        }
      };
    
    case 'registry':
      return {
        type: 'registry',
        packageName: spec.name!,
        version: spec.version,
        resourcePath: spec.path,
        features: {
          hasResourcePath,
          hasConvenienceFilters
        }
      };
    
    default:
      throw new Error(`Unknown resource spec type: ${(spec as any).type}`);
  }
}

/**
 * Convert legacy PackageInputClassification to InputClassification
 */
function legacyToClassification(
  legacy: Awaited<ReturnType<typeof classifyPackageInput>>,
  hasConvenienceFilters: boolean
): InputClassification {
  switch (legacy.type) {
    case 'git':
      return {
        type: 'git',
        gitUrl: legacy.gitUrl!,
        gitRef: legacy.gitRef,
        resourcePath: legacy.gitPath,
        features: {
          hasResourcePath: !!legacy.gitPath,
          hasConvenienceFilters
        }
      };
    
    case 'directory':
    case 'tarball':
      return {
        type: 'path',
        localPath: legacy.resolvedPath!,
        features: {
          hasResourcePath: false,
          hasConvenienceFilters
        }
      };
    
    case 'registry':
      return {
        type: 'registry',
        packageName: legacy.name!,
        version: legacy.version,
        features: {
          hasResourcePath: !!legacy.registryPath,
          hasConvenienceFilters
        }
      };
    
    default:
      throw new Error(`Unknown legacy classification type: ${legacy.type}`);
  }
}
