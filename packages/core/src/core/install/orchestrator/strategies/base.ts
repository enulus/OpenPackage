import type { InstallationContext } from '../../unified/context.js';
import type { ExecutionContext } from '../../../../types/index.js';
import type { 
  NormalizedInstallOptions, 
  InputClassification, 
  PreprocessResult,
  InstallStrategy 
} from '../types.js';

/**
 * Abstract base class for install strategies.
 * Provides common functionality.
 */
export abstract class BaseInstallStrategy implements InstallStrategy {
  abstract readonly name: string;
  
  abstract canHandle(classification: InputClassification): boolean;
  
  abstract buildContext(
    classification: InputClassification,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<InstallationContext>;
  
  abstract preprocess(
    context: InstallationContext,
    options: NormalizedInstallOptions,
    execContext: ExecutionContext
  ): Promise<PreprocessResult>;
  
  /**
   * Create a simple preprocess result with no special handling.
   */
  protected createNormalResult(context: InstallationContext): PreprocessResult {
    return { context };
  }
  
  /**
   * Create a marketplace preprocess result.
   */
  protected createMarketplaceResult(
    context: InstallationContext,
    manifest?: any
  ): PreprocessResult {
    return {
      context,
      specialHandling: 'marketplace',
      marketplaceManifest: manifest
    };
  }
  
  /**
   * Create an ambiguous preprocess result.
   */
  protected createAmbiguousResult(
    context: InstallationContext,
    matches: Array<{ pattern: string; base: string; startIndex: number }>
  ): PreprocessResult {
    return {
      context,
      specialHandling: 'ambiguous',
      ambiguousMatches: matches
    };
  }
  
  /**
   * Create a multi-resource preprocess result.
   */
  protected createMultiResourceResult(
    context: InstallationContext,
    resourceContexts: InstallationContext[]
  ): PreprocessResult {
    return {
      context,
      specialHandling: 'multi-resource',
      resourceContexts
    };
  }
}
